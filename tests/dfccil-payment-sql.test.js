import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const user = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const virtual = "cdab677d-fa11-480b-baf7-6806ade66186";
const order = "A1B2C3D4E5F60718293A4B5C6D7E8F";
async function reserve(actor = user, subject = virtual) {
  return (
    await db.query(
      "SELECT ev_dfccil_prepare_payment($1,$2,$3,$4,$5,$6) AS result",
      [
        actor,
        subject,
        session,
        "EV001",
        "f51c3d26cd09487eb2350a9742b8af18",
        30,
      ],
    )
  ).rows[0].result;
}
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE "EV_Users"(id uuid PRIMARY KEY,sso_sub text,role text,status text);
 CREATE TABLE "EV_ChargingSessions"(id uuid PRIMARY KEY,user_id uuid,tariff_id uuid,energy_kwh numeric,end_time timestamptz,status text,amount numeric,
   payment_status text,prepaid_mode text,prepaid_total_inr numeric,rate_per_kwh_snapshot numeric,session_fee_snapshot numeric,gst_percent_snapshot numeric);
 CREATE TABLE "EV_Payments"(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid,user_id uuid,amount numeric,gst_amount numeric,total_amount numeric,status text,gateway text,gateway_txn_id text,gateway_order_id text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE FUNCTION ev_calculate_session_bill(numeric,uuid) RETURNS TABLE(amount numeric,gst_amount numeric,total_amount numeric) LANGUAGE sql AS $$SELECT 22::numeric,3.96::numeric,25.96::numeric$$;`);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261104_dfccil_payment_attempts.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(await readFile(new URL("../supabase/migrations/20261104_dfccil_payment_verification.sql", import.meta.url), "utf8"));
});
beforeEach(async () => {
  await db.exec(
    'TRUNCATE "EV_DfccilPaymentAttempts","EV_Payments","EV_ChargingSessions","EV_Users" CASCADE',
  );
  await db.query(
    "INSERT INTO \"EV_Users\" VALUES($1,$2,'User','active'),($3,'a36f76cb-cef6-4b7b-9053-d5a54ab11dfd','User','active')",
    [user, virtual, foreign],
  );
  await db.query(
    "INSERT INTO \"EV_ChargingSessions\"(id,user_id,tariff_id,energy_kwh,end_time,status,payment_status,prepaid_mode,prepaid_total_inr,rate_per_kwh_snapshot,session_fee_snapshot,gst_percent_snapshot) VALUES($1,$2,$1,2,now(),'completed','unpaid','amount',100,12,1,18)",
    [session, user],
  );
});
after(() => db.close());
test("migration executes and reservation computes a fixed bill from server tariff snapshots", async () => {
  const { attempt, created } = await reserve();
  assert.equal(created, true);
  assert.equal(Number(attempt.amount), 29.5);
  assert.equal(attempt.virtual_id, virtual);
  assert.equal(attempt.user_id, user);
  assert.equal(attempt.resolution, "open");
  assert.equal(
    (await db.query('SELECT status FROM "EV_Payments"')).rows[0].status,
    "pending",
  );
});
test("duplicate reservation returns the same attempt and creates only one payment", async () => {
  const one = await reserve(),
    two = await reserve();
  assert.equal(two.created, false);
  assert.equal(two.attempt.id, one.attempt.id);
  assert.equal(
    (await db.query('SELECT count(*)::integer n FROM "EV_Payments"')).rows[0].n,
    1,
  );
});
test("private ownership, subject and inactive account checks are enforced in the database", async () => {
  await assert.rejects(
    reserve(foreign, "a36f76cb-cef6-4b7b-9053-d5a54ab11dfd"),
    /SESSION_NOT_FOUND/,
  );
  await assert.rejects(
    reserve(user, "a36f76cb-cef6-4b7b-9053-d5a54ab11dfd"),
    /PAYMENT_ACCESS_DENIED/,
  );
  await db.query("UPDATE \"EV_Users\" SET status='suspended' WHERE id=$1", [
    user,
  ]);
  await assert.rejects(reserve(), /PAYMENT_ACCESS_DENIED/);
});
test("active sessions, paid bills and ambiguous legacy paid metadata cannot create orders", async () => {
  await db.exec("UPDATE \"EV_ChargingSessions\" SET status='active'");
  await assert.rejects(reserve(), /BILL_NOT_FINAL/);
  await db.exec(
    "UPDATE \"EV_ChargingSessions\" SET status='completed',payment_status='paid'",
  );
  await assert.rejects(reserve(), /BILL_REQUIRES_RECONCILIATION/);
  await db.exec("UPDATE \"EV_ChargingSessions\" SET payment_status='unpaid'");
  const a = await reserve();
  await db.query("UPDATE \"EV_Payments\" SET status='success' WHERE id=$1", [
    a.attempt.payment_id,
  ]);
  await assert.rejects(reserve(), /BILL_ALREADY_PAID/);
});
test("unverified CHARGED, duplicate and out-of-order returns never mark a bill paid", async () => {
  const { attempt } = await reserve();
  await db.query(
    "UPDATE \"EV_DfccilPaymentAttempts\" SET order_id=$1,creation_state='ready' WHERE id=$2",
    [order, attempt.id],
  );
  for (const state of ["CHARGED", "CHARGED", "FAILED", "CANCELLED"]) {
    const result = (
      await db.query("SELECT ev_dfccil_record_return($1,$2) AS result", [
        order,
        state,
      ])
    ).rows[0].result;
    assert.equal(result.verified, false);
  }
  const row = (await db.query('SELECT * FROM "EV_DfccilPaymentAttempts"'))
    .rows[0];
  assert.equal(row.reported_status, "CHARGED");
  assert.equal(row.verified_at, null);
  assert.equal(row.resolution, "open");
  assert.equal(
    (await db.query('SELECT status FROM "EV_Payments"')).rows[0].status,
    "pending",
  );
  assert.equal((await reserve()).created, false);
});
test("verified success cannot be downgraded and is never reopened", async () => {
  const { attempt } = await reserve();
  await db.query(
    "UPDATE \"EV_DfccilPaymentAttempts\" SET order_id=$1,resolution='paid',verified_at=now(),reported_status='CHARGED' WHERE id=$2",
    [order, attempt.id],
  );
  const result = (
    await db.query("SELECT ev_dfccil_record_return($1,$2) AS result", [
      order,
      "FAILED",
    ])
  ).rows[0].result;
  assert.equal(result.verified, true);
  assert.equal((await reserve()).created, false);
  assert.equal(
    (await db.query('SELECT reported_status FROM "EV_DfccilPaymentAttempts"'))
      .rows[0].reported_status,
    "CHARGED",
  );
});
test("paid ledger entries require verification and external order IDs are unique", async () => {
  const { attempt } = await reserve();
  await assert.rejects(
    db.query(
      "UPDATE \"EV_DfccilPaymentAttempts\" SET resolution='paid' WHERE id=$1",
      [attempt.id],
    ),
  );
});
test("anon clients cannot read the ledger or invoke payment mutation functions", async () => {
  await db.exec("SET ROLE anon");
  try {
    await assert.rejects(
      db.exec('SELECT * FROM "EV_DfccilPaymentAttempts"'),
      /permission denied/,
    );
    await assert.rejects(reserve(), /permission denied/);
  } finally {
    await db.exec("RESET ROLE");
  }
});

test("an external gateway order cannot be assigned to two attempts", async () => {
  const first = await reserve();
  await db.query(
    "UPDATE \"EV_DfccilPaymentAttempts\" SET order_id=$1,resolution='failed' WHERE id=$2",
    [order, first.attempt.id],
  );
  const second = await reserve();
  assert.notEqual(first.attempt.id, second.attempt.id);
  await assert.rejects(
    db.query('UPDATE "EV_DfccilPaymentAttempts" SET order_id=$1 WHERE id=$2', [
      order,
      second.attempt.id,
    ]),
    /unique/,
  );
});
test("a tariff fallback is calculated on the server and invalid snapshots are rejected", async () => {
  await db.exec('UPDATE "EV_ChargingSessions" SET rate_per_kwh_snapshot=NULL');
  assert.equal(Number((await reserve()).attempt.amount), 25.96);
});

test("invalid financial snapshots cannot reserve a payment", async () => {
  await db.exec('UPDATE "EV_ChargingSessions" SET gst_percent_snapshot=1000');
  await assert.rejects(reserve(), /INVALID_BILL/);
  assert.equal(
    (await db.query('SELECT count(*)::integer n FROM "EV_Payments"')).rows[0].n,
    0,
  );
});

async function readyAttempt() {
  const { attempt } = await reserve();
  await db.query('UPDATE "EV_DfccilPaymentAttempts" SET order_id=$1,creation_state=\'ready\' WHERE id=$2', [order, attempt.id]);
  return attempt;
}
async function claim(id) {
  return (await db.query('SELECT ev_dfccil_claim_status($1,$2) result',[id,user])).rows[0].result;
}
async function finalize(a, changes={}) {
  const result={orderId:order,appId:'EV001',amount:29.5,status:'CHARGED',statusGroup:'SUCCESS',hasReceipt:true,...changes};
  return (await db.query('SELECT ev_dfccil_finalize_status($1,$2,$3) result',[a.id,a.status_check_token,JSON.stringify(result)])).rows[0].result;
}
test('status lease rate limits repeated checks and binds ownership',async()=>{
 const a=await readyAttempt(); const one=await claim(a.id), two=await claim(a.id);
 assert.equal(one.check,true); assert.equal(two.check,false);
 await assert.rejects(db.query('SELECT ev_dfccil_claim_status($1,$2)',[a.id,foreign]),/PAYMENT_NOT_FOUND/);
});
test('trusted success atomically settles payment and session and cannot be downgraded',async()=>{
 const a=(await claim((await readyAttempt()).id)).attempt;
 assert.equal((await finalize(a)).resolution,'paid');
 assert.equal((await db.query('SELECT status FROM "EV_Payments"')).rows[0].status,'success');
 assert.equal((await db.query('SELECT payment_status FROM "EV_ChargingSessions"')).rows[0].payment_status,'paid');
 assert.equal((await finalize(a,{status:'FAILED',statusGroup:'FAILED'})).resolution,'paid');
 await assert.rejects(reserve(),/BILL_ALREADY_PAID/);
});
test('mismatched amount, order, app and stale leases cannot settle a bill',async()=>{
 const a=(await claim((await readyAttempt()).id)).attempt;
 for(const mismatch of [{amount:1},{orderId:'another-order'},{appId:'other'},{statusGroup:'PENDING'}])
  await assert.rejects(finalize(a,mismatch),/MISMATCH|INVALID/);
 await assert.rejects(finalize({...a,status_check_token:user}),/STALE_STATUS_CHECK/);
 assert.equal((await db.query('SELECT status FROM "EV_Payments"')).rows[0].status,'pending');
});
test('verified cancellation permits a new order while unsigned cancellation does not',async()=>{
 const a=(await claim((await readyAttempt()).id)).attempt;
 await db.query('SELECT ev_dfccil_record_return($1,$2)',[order,'CANCELLED']);
 assert.equal((await reserve()).created,false);
 assert.equal((await finalize(a,{status:'CANCELLED',statusGroup:'FAILED',hasReceipt:true})).resolution,'cancelled');
 assert.equal((await reserve()).created,true);
});
test('amount mismatch status is held for reconciliation and cannot be retried',async()=>{
 const a=(await claim((await readyAttempt()).id)).attempt;
 assert.equal((await finalize(a,{status:'AMOUNT_MISMATCH',statusGroup:'FAILED'})).resolution,'open');
 assert.equal((await reserve()).created,false);
});
test('anon cannot claim or finalize status',async()=>{
 const a=(await claim((await readyAttempt()).id)).attempt;
 await db.exec('SET ROLE anon');
 try {await assert.rejects(claim(a.id),/permission denied/);await assert.rejects(finalize(a),/permission denied/);}
 finally {await db.exec('RESET ROLE');}
});
test('pending status does not settle and the lease can renew after 30 seconds',async()=>{
 const a=(await claim((await readyAttempt()).id)).attempt;
 assert.equal((await finalize(a,{status:'INITIATED',statusGroup:'PENDING',hasReceipt:false})).resolution,'open');
 await db.exec('UPDATE "EV_DfccilPaymentAttempts" SET status_checked_at=now()-interval \'31 seconds\'');
 const fresh=await claim(a.id);assert.equal(fresh.check,true);
 await assert.rejects(finalize(a),/STALE_STATUS_CHECK/);
 assert.equal((await finalize(fresh.attempt)).resolution,'paid');
});
test('late success on a failed old order cannot settle over a different active attempt',async()=>{
 const a=(await claim((await readyAttempt()).id)).attempt;
 await finalize(a,{status:'FAILED',statusGroup:'FAILED'});
 await reserve();
 await assert.rejects(finalize(a),/BILL_REQUIRES_RECONCILIATION/);
 assert.equal((await db.query('SELECT payment_status FROM "EV_ChargingSessions"')).rows[0].payment_status,'unpaid');
});
test('missing status and changed session ownership cannot authorize settlement',async()=>{
 const a=(await claim((await readyAttempt()).id)).attempt;
 await assert.rejects(finalize(a,{status:null}),/GATEWAY_STATUS_INVALID/);
 await db.query('UPDATE "EV_ChargingSessions" SET user_id=$1',[foreign]);
 await assert.rejects(finalize(a),/SESSION_OWNER_MISMATCH/);
 assert.equal((await db.query('SELECT status FROM "EV_Payments"')).rows[0].status,'pending');
});
