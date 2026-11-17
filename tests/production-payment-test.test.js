import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { productionTestHandler } from "../server/payments/production-test.js";
import { submitReservedPayment, verifyPaymentStatus } from "../server/payments/dfccil.js";
const user = "11111111-1111-4111-8111-111111111111";
const virtual = "cdab677d-fa11-480b-baf7-6806ade66186";
const auth = { user: { id: user, role: "User" }, claims: { virtualId: virtual } };
const config = { baseUrl: "https://epay.dfccil.com", appId: "EV001", natureId: 30, returnUrl: "https://ev-cms-rho.vercel.app/api/payments/dfccil/return" };
async function invoke(handle, body) {
 const res = { setHeader() {}, status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; } };
 await handle({ method: "POST", headers: { authorization: "Bearer fixture" }, body },res); return res;
}
test("real order requires auth, dedicated enable flag, confirmation, fixed gateway and no supplied amount", async () => {
 let touched=false;
 const options={ authorize: async()=>auth, db:()=>{ touched=true; throw Error(); }, env:()=>({}) };
 assert.equal((await invoke(productionTestHandler(options),{action:"create",confirmRealPayment:true})).code,503);
 options.env=()=>({DFCCIL_PRODUCTION_TEST_ENABLED:"true"});
 assert.equal((await invoke(productionTestHandler(options),{action:"create"})).code,400);
 assert.equal((await invoke(productionTestHandler(options),{action:"create",confirmRealPayment:true,amount:5})).code,400);
 options.env=()=>({DFCCIL_PRODUCTION_TEST_ENABLED:"true",DFCCIL_PAYMENT_BASE_URL:"https://wrong.example"});
 assert.equal((await invoke(productionTestHandler(options),{action:"create",confirmRealPayment:true})).code,503);
 assert.equal(touched,false);
 options.authorize=async()=>{throw Error();};
 assert.equal((await invoke(productionTestHandler(options),{action:"status"})).code,401);
});
test("reserved test uses real gateway payload and validates checkout host", async () => {
 const a={id:user,user_id:user,amount:1,creation_state:"reserved",resolution:"open"};
 const updates=[];
 const request=async(url,init)=>{
   assert.equal(url,"https://epay.dfccil.com/Payment/SavePaymentData");
   const body=JSON.parse(init.body);
   assert.equal(body.Amount,1); assert.equal(body.VirtualId,virtual);
   assert.equal(body.Description,"Production verification INR 1");
   return Response.json({orderId:"ORDER123456",paymentUrl:"https://epay.dfccil.com/Payment/Pay/ORDER123456"});
 };
 const result=await submitReservedPayment(auth,a,{update:async(id,values)=>updates.push(values)},config,request,"Production verification INR 1");
 assert.equal(result.canOpenCheckout,true); assert.equal(result.verified,false);
 assert.equal(updates[0].order_id,"ORDER123456");
});
const db = new PGlite();
before(async()=>{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE "EV_Users"(id uuid PRIMARY KEY,sso_sub text,role text,status text);`);
 await db.exec(await readFile(new URL("../supabase/migrations/20261117_dfccil_production_test.sql",import.meta.url),"utf8"));
 await db.query(`INSERT INTO "EV_Users" VALUES($1,$2,'User','active')`,[user,virtual]);
});
after(()=>db.close());
test("isolated ledger reserves only one INR 1 order and verifies settlement without charging tables",async()=>{
 const reserve=async()=> (await db.query("SELECT ev_dfccil_test_reserve($1,$2,'EV001',30) AS result",[user,virtual])).rows[0].result;
 const first=await reserve(); assert.equal(first.created,true); assert.equal(Number(first.attempt.amount),1);
 const repeated=await reserve(); assert.equal(repeated.created,false); assert.equal(repeated.attempt.id,first.attempt.id);
 await assert.rejects(db.query("SELECT ev_dfccil_test_reserve($1,$2,'EV001',30)",[user,user]));
 const id=first.attempt.id;
 await db.query(`UPDATE "EV_DfccilProductionTests" SET order_id='ORDER123456',creation_state='ready' WHERE id=$1`,[id]);
 const claim=(await db.query("SELECT ev_dfccil_test_claim($1,$2) AS result",[user,id])).rows[0].result;
 assert.equal(claim.check,true);
 assert.equal((await db.query("SELECT ev_dfccil_test_claim($1,$2) AS result",[user,id])).rows[0].result.check,false);
 const result={orderId:"ORDER123456",appId:"EV001",amount:1,status:"CHARGED",statusGroup:"SUCCESS",hasReceipt:true};
 const finalize=async(value,token=claim.attempt.status_check_token)=>(await db.query("SELECT ev_dfccil_test_finalize($1,$2,$3) AS result",[id,token,JSON.stringify(value)])).rows[0].result;
 await assert.rejects(finalize({...result,amount:2}));
 await assert.rejects(finalize(result,user));
 const paid=await finalize(result); assert.equal(paid.resolution,"paid"); assert.ok(paid.verified_at);
 assert.equal((await finalize({...result,status:"FAILED",statusGroup:"FAILED"})).resolution,"paid");
 assert.equal((await reserve()).created,false);
 const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(r=>r.tablename);
 assert.equal(tables.includes("EV_ChargingSessions"),false); assert.equal(tables.includes("EV_Payments"),false);
});
test("shared verifier rejects mismatching gateway amount before finalization",async()=>{
 const a={id:user,user_id:user,order_id:"ORDER123456",app_id:"EV001",amount:1,resolution:"open"};
 let finalized=false;
 const store={claimStatus:async()=>({check:true,attempt:a}),finalizeStatus:async()=>{finalized=true;}};
 await assert.rejects(verifyPaymentStatus(auth,a,store,config,async()=>Response.json({orderId:a.order_id,appId:"EV001",amount:2,status:"CHARGED",statusGroup:"SUCCESS"})));
 assert.equal(finalized,false);
});

test("repeated creates reuse one durable order and creation stays blocked when disabled",async()=>{
 let row=null; let creates=0;
 const fakeDb={
   rpc:async(name,args)=>{
     if(name==="ev_dfccil_test_reserve") {
       const created=!row;
       row ||= {id:user,user_id:user,app_id:"EV001",amount:1,resolution:"open",creation_state:"reserved"};
       return {data:{created,attempt:{...row}}};
     }
     if(name==="ev_dfccil_test_claim") return {data:{check:false,attempt:{...row}}};
     throw Error(name);
   },
   from:()=>({
     update:values=>({eq:async()=>{Object.assign(row,values);return {error:null};}}),
     select:()=>({eq:()=>({maybeSingle:async()=>({data:row,error:null})})}),
   }),
 };
 let enabled=true;
 const h=productionTestHandler({authorize:async()=>auth,db:()=>fakeDb,
   env:()=>({DFCCIL_PRODUCTION_TEST_ENABLED:String(enabled)}),
   request:async()=>{creates++;return Response.json({orderId:"ORDER123456",paymentUrl:"https://epay.dfccil.com/Payment/Pay/ORDER123456"});},
 });
 const first=await invoke(h,{action:"create",confirmRealPayment:true});
 assert.equal(first.code,200); assert.equal(first.body.attempt.amount,1);
 const repeated=await invoke(h,{action:"create",confirmRealPayment:true});
 assert.equal(repeated.code,200); assert.equal(repeated.body.attempt.attemptId,first.body.attempt.attemptId);
 assert.equal(creates,1);
 enabled=false;
 assert.equal((await invoke(h,{action:"create",confirmRealPayment:true})).code,503);
 assert.equal((await invoke(h,{action:"status"})).code,200);
 assert.equal(creates,1);
});
