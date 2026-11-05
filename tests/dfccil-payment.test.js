import test from "node:test";
import assert from "node:assert/strict";
import {
  configuration,
  checkoutUrl,
  publicAttempt,
  createPayment,
  recordReturn,
  receipt,
  CLIENT_ID,
  verifyPaymentStatus,
} from "../server/payments/dfccil.js";
const sessionId = "11111111-1111-4111-8111-111111111111";
const attemptId = "22222222-2222-4222-8222-222222222222";
const virtualId = "cdab677d-fa11-480b-baf7-6806ade66186";
const auth = {
  user: { id: "33333333-3333-4333-8333-333333333333", role: "User" },
  claims: { virtualId, sub: "internal-user-id" },
};
const config = { ...configuration({}), enabled: true };
const orderId = "A1B2C3D4E5F60718293A4B5C6D7E8F";
function storeFixture() {
  const row = {
    id: attemptId,
    session_id: sessionId,
    user_id: auth.user.id,
    payment_id: sessionId,
    amount: "123.45",
    creation_state: "reserved",
    resolution: "open",
    reported_status: null,
  };
  let created = true;
  return {
    row,
    async reserve() {
      const result = { created, attempt: { ...row } };
      created = false;
      return result;
    },
    async update(id, values) {
      assert.equal(id, attemptId);
      Object.assign(row, values);
    },
    async latest() {
      return { ...row };
    },
  };
}
function paidResponse() {
  return Response.json({
    orderId,
    paymentUrl: `${config.baseUrl}/Payment/Pay/${orderId}`,
  });
}

test("payment creation uses server bill and external Virtual ID, with no personal details", async () => {
  const store = storeFixture();
  let calls = 0;
  const result = await createPayment(
    auth,
    { sessionId },
    store,
    config,
    async (url, request) => {
      calls++;
      assert.equal(url, "https://epay.dfccil.com/Payment/SavePaymentData");
      assert.deepEqual(JSON.parse(request.body), {
        AppId: "EV001",
        ClientId: CLIENT_ID,
        VirtualId: virtualId,
        Amount: 123.45,
        Description: `EV charging bill ${sessionId}`,
        NatureOfPaymentId: "30",
        ReturnUrl: config.returnUrl,
      });
      assert.equal(request.redirect, "error");
      return paidResponse();
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.status, "pending");
  assert.equal(result.canOpenCheckout, true);
  assert.equal(result.verified, false);
  await createPayment(auth, { sessionId }, store, config, async () => {
    throw new Error("Duplicate external call");
  });
  assert.equal(store.row.creation_state, "ready");
});
for (const input of [
  { sessionId, Amount: 1 },
  { sessionId, VirtualId: sessionId },
  { sessionId, ReturnUrl: "https://evil.test" },
  { sessionId, AppId: "other" },
  { sessionId: "bad" },
]) {
  test(`rejects client-controlled payment fields ${JSON.stringify(input)}`, async () =>
    assert.rejects(createPayment(auth, input, storeFixture(), config)));
}
test("live payments are disabled unless explicitly enabled; admin cannot pay for users", async () => {
  await assert.rejects(
    createPayment(auth, { sessionId }, storeFixture(), {
      ...config,
      enabled: false,
    }),
  );
  await assert.rejects(
    createPayment(
      { ...auth, user: { ...auth.user, role: "SuperAdmin" } },
      { sessionId },
      storeFixture(),
      config,
    ),
  );
});
test("timeout leaves an open unconfirmed attempt and cannot create a second order", async () => {
  const store = storeFixture();
  let calls = 0;
  await assert.rejects(
    createPayment(auth, { sessionId }, store, config, async () => {
      calls++;
      throw new Error("Timeout");
    }),
  );
  assert.equal(store.row.creation_state, "unknown");
  assert.equal(store.row.resolution, "open");
  const result = await createPayment(
    auth,
    { sessionId },
    store,
    config,
    async () => {
      calls++;
      return paidResponse();
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.status, "creation_pending");
  assert.equal(result.canOpenCheckout, false);
});
test("provider rejection differs from ambiguous server failure", async () => {
  for (const status of [400, 500]) {
    const store = storeFixture();
    const result = await createPayment(
      auth,
      { sessionId },
      store,
      config,
      async () => new Response(status === 400 ? JSON.stringify({detail:"Unknown AppId"}) : "{}", { status, headers: {"Content-Type":"application/problem+json"} }),
    );
    assert.equal(result.status, status === 400 ? "failed" : "creation_pending");
    assert.equal(store.row.resolution, status === 400 ? "failed" : "open");
  }
});
test("malicious checkout redirects cannot be opened or retried as new orders", async () => {
  const store = storeFixture();
  await assert.rejects(
    createPayment(auth, { sessionId }, store, config, async () =>
      Response.json({ orderId, paymentUrl: "https://attacker.test/pay" }),
    ),
  );
  assert.equal(store.row.creation_state, "unknown");
  assert.equal(store.row.order_id, orderId);
});
for (const url of [
  "http://epay.dfccil.com/Payment/Pay/" + orderId,
  "https://epay.dfccil.com.attacker.test/Payment/Pay/" + orderId,
  config.baseUrl + "/Payment/Pay/" + orderId + "?redirect=https://evil.test",
]) {
  test(`rejects unsafe checkout URL ${url}`, () =>
    assert.throws(() => checkoutUrl(orderId, url, config)));
}
test("configuration rejects non-HTTPS callback and credential-bearing URLs", () => {
  assert.throws(() =>
    configuration({ DFCCIL_PAYMENT_RETURN_URL: "http://localhost/callback" }),
  );
  assert.throws(() =>
    configuration({
      DFCCIL_PAYMENT_BASE_URL: "https://secret@epay.dfccil.com",
    }),
  );
  assert.throws(() => configuration({ DFCCIL_NATURE_OF_PAYMENT_ID: "bad" }));
});
test("an unsigned CHARGED report is pending, never verified or checkout-ready", async () => {
  const store = storeFixture();
  await createPayment(auth, { sessionId }, store, config, async () =>
    paidResponse(),
  );
  store.row.reported_status = "CHARGED";
  const view = publicAttempt(store.row);
  assert.equal(view.status, "pending_verification");
  assert.equal(view.verified, false);
  assert.equal(view.canOpenCheckout, false);
  assert.equal(view.checkoutUrl, null);
  assert.equal("virtual_id" in view, false);
  assert.equal("user_id" in view, false);
});
test("known callback is recorded as a report only; forged and duplicate parameters are rejected", async () => {
  const calls = [];
  const store = {
    async reported(...args) {
      calls.push(args);
      return { attemptId, verified: false };
    },
  };
  assert.equal(
    (
      await recordReturn(
        `/api/payments/dfccil/return?orderId=${orderId}&txnStatus=CHARGED`,
        store,
      )
    ).verified,
    false,
  );
  assert.deepEqual(calls, [[orderId, "CHARGED"]]);
  await assert.rejects(
    recordReturn(
      `/?orderId=${orderId}&txnStatus=CHARGED&txnStatus=FAILED`,
      store,
    ),
  );
  await assert.rejects(
    recordReturn("/?orderId=../../evil&txnStatus=CHARGED", store),
  );
  await assert.rejects(recordReturn(`/?txnStatus=CHARGED`, store));
});
test("unverified, nonexistent and foreign-owned payments cannot yield a receipt", async () => {
  const store = storeFixture();
  let requests = 0;
  await assert.rejects(
    receipt(auth, attemptId, store, config, async () => {
      requests++;
    }),
  );
  await assert.rejects(
    receipt(
      auth,
      attemptId,
      {
        async latest() {
          return null;
        },
      },
      config,
    ),
  );
  assert.equal(requests, 0);
});
test("only verified payments retrieve an official PDF from the fixed gateway", async () => {
  const store = storeFixture();
  Object.assign(store.row, {
    order_id: orderId,
    resolution: "paid",
    verified_at: new Date().toISOString(),
  });
  const pdf = await receipt(auth, attemptId, store, config, async (url) => {
    assert.equal(url, `${config.baseUrl}/Payment/GetReceipt/${orderId}`);
    return new Response("%PDF-1.7\nfixture", {
      headers: { "Content-Type": "application/pdf" },
    });
  });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  await assert.rejects(
    receipt(
      auth,
      attemptId,
      store,
      config,
      async () =>
        new Response("not PDF", {
          headers: { "Content-Type": "application/pdf" },
        }),
    ),
  );
});

test('unknown client errors and rate limits do not permit duplicate order creation', async () => {
  for (const status of [400, 408, 429]) {
    const store = storeFixture();
    const result = await createPayment(auth, { sessionId }, store, config, async () =>
      new Response(JSON.stringify({ detail: 'Unspecified proxy failure' }), {
        status, headers: { 'Content-Type': 'application/problem+json' },
      }),
    );
    assert.equal(result.status, 'creation_pending');
    assert.equal(store.row.resolution, 'open');
  }
});

function statusFixture() {
 const store=storeFixture();
 Object.assign(store.row,{order_id:orderId,app_id:'EV001',creation_state:'ready',status_check_token:attemptId});
 let claimed=false;
 store.claimStatus=async()=>({check:!claimed && (claimed=true),attempt:{...store.row}});
 store.finalizeStatus=async(a,result)=>{
  store.finalized=result;
  Object.assign(store.row,{resolution:result.statusGroup==='SUCCESS'?'paid':result.statusGroup==='FAILED'?'failed':'open',verified_at:result.statusGroup==='SUCCESS'?new Date().toISOString():null});
  return {...store.row};
 };
 return store;
}
const statusResult={orderId,appId:'EV001',amount:123.45,status:'CHARGED',statusGroup:'SUCCESS',hasReceipt:true};
test('server verifies status over fixed HTTPS and persists only matching gateway evidence',async()=>{
 const store=statusFixture();
 const row=await verifyPaymentStatus(auth,store.row,store,config,async(url,options)=>{
  assert.equal(url,`https://epay.dfccil.com/Payment/Status/${orderId}`);
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  return Response.json(statusResult);
 });
 assert.equal(row.resolution,'paid');assert.equal(store.finalized.amount,123.45);
});
for(const changes of [{appId:'other'},{orderId:'different-order'},{amount:1},{amount:'123.45'},
 {statusGroup:'SUCCESS',status:'FAILED'},{status:'CHARGED',statusGroup:'PENDING'},{hasReceipt:'true'}]) {
 test(`invalid status response never finalizes ${JSON.stringify(changes)}`,async()=>{
  const store=statusFixture();
  await assert.rejects(verifyPaymentStatus(auth,store.row,store,config,async()=>Response.json({...statusResult,...changes})));
  assert.equal(store.finalized,undefined);
 });
}
test('cached lease, absent orders and verified success do not call gateway',async()=>{
 const store=statusFixture();let calls=0;
 await verifyPaymentStatus(auth,store.row,store,config,async()=>{calls++;return Response.json({...statusResult,status:'INITIATED',statusGroup:'PENDING'});});
 await verifyPaymentStatus(auth,store.row,store,config,async()=>{throw Error('must use cache');});
 await verifyPaymentStatus(auth,{...store.row,resolution:'paid'},store,config,async()=>{throw Error('paid');});
 await verifyPaymentStatus(auth,{...store.row,order_id:null},store,config,async()=>{throw Error('no order');});
 assert.equal(calls,1);
});
for(const response of [()=>Response.json({},{status:404}),()=>{throw Error('timeout');},()=>new Response('invalid json')]) {
 test('gateway errors never settle or release the pending order',async()=>{
  const store=statusFixture();
  await assert.rejects(verifyPaymentStatus(auth,store.row,store,config,response));
  assert.equal(store.finalized,undefined);assert.equal(store.row.resolution,'open');
 });
}
test('foreign-owned status cannot query gateway',async()=>{
 const store=statusFixture();await assert.rejects(verifyPaymentStatus(auth,{...store.row,user_id:sessionId},store,config,async()=>{throw Error('not reached');}),/not found/);
});

test('verified INITIATED orders remain available for checkout; failed records are never payment proof',()=>{
 const a={...storeFixture().row,creation_state:'ready',checkout_url:'checkout',reported_status:'INITIATED',gateway_status:'INITIATED'};
 assert.equal(publicAttempt(a).canOpenCheckout,true);
 assert.equal(publicAttempt({...a,reported_status:'FAILED',gateway_status:'FAILED',resolution:'failed',has_receipt:true}).verified,false);
 assert.equal(publicAttempt({...a,reported_status:'PaymentLinkUsed',gateway_status:'PaymentLinkUsed'}).canOpenCheckout,false);
});
