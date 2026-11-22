import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { productionTestHandler } from "../server/payments/production-test.js";
const user = "11111111-1111-4111-8111-111111111111";
const virtualId = "cdab677d-fa11-480b-baf7-6806ade66186";
const key = () => new TextEncoder().encode("fixture-secret-at-least-thirty-two-bytes");
const auth = { user: { id: user, role: "User" }, claims: { virtualId } };
const mobileEpayHeader = "a".repeat(64);
function handler(options = {}) { return productionTestHandler({ authorize: async () => auth, key, env: () => ({ DFCCIL_PRODUCTION_TEST_ENABLED: "true", DFCCIL_MOBILE_EPAY_HEADER: mobileEpayHeader }), ...options }); }
async function call(h, body) {
 const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await h({method:"POST",headers:{authorization:"Bearer fixture"},body},res);return res;
}
async function prepare(h) { return (await call(h,{action:"prepare",confirmRealPayment:true})).body.reference; }
test("auth, feature flag, confirmation and fixed amount are required",async()=>{
 assert.equal((await call(handler({authorize:async()=>{throw Error();}}),{action:"status"})).code,401);
 const disabled=handler({env:()=>({})});
 assert.equal((await call(disabled,{action:"prepare",confirmRealPayment:true})).code,503);
 assert.equal((await call(disabled,{action:"status"})).body.attempt,null);
 assert.equal((await call(handler(),{action:"prepare"})).code,400);
 assert.equal((await call(handler(),{action:"prepare",confirmRealPayment:true,amount:2})).code,400);
 assert.equal((await call(handler(),{action:"create",confirmRealPayment:true})).code,409);
});
test("prepare never calls gateway; real creation, restoration and verification need no DB",async()=>{
 let orders=0; let statuses=0;
 const h=handler({request:async(url,init)=>{
  if(url.endsWith("SavePaymentData")){
   orders++;const payload=JSON.parse(init.body);assert.equal(payload.Amount,1);assert.equal(payload.VirtualId,virtualId);
   assert.equal(payload.ReturnUrl,"https://ev-cms-rho.vercel.app/api/payments/dfccil/return");
   assert.equal(init.headers["mobile-epay"],mobileEpayHeader);
   return Response.json({orderId:"ORDER123456",paymentUrl:"https://epay.dfccil.com/Payment/Pay/ORDER123456"});
  }
  statuses++;return Response.json({orderId:"ORDER123456",appId:"EV001",amount:1,status:"CHARGED",statusGroup:"SUCCESS"});
 }});
 const reference=await prepare(h);assert.equal(orders,0);
 const created=await call(h,{action:"create",reference,confirmRealPayment:true});
 assert.equal(created.code,200);assert.equal(created.body.attempt.canOpenCheckout,true);assert.equal(orders,1);
 assert.equal((await call(h,{action:"create",reference:created.body.reference,confirmRealPayment:true})).code,409);
 const paid=await call(h,{action:"status",reference:created.body.reference});
 assert.equal(paid.body.attempt.verified,true);assert.equal(statuses,1);assert.equal(orders,1);
 const restored=await call(h,{action:"status",reference:paid.body.reference});
 assert.equal(restored.body.attempt.verified,true);assert.equal(statuses,1);
});
test("signed reference is scoped to owner and cannot be forged with an SSO token",async()=>{
 const reference=await prepare(handler());
 const other=handler({authorize:async()=>({...auth,user:{id:virtualId,role:"User"}})});
 assert.equal((await call(other,{action:"status",reference})).code,403);
 assert.equal((await call(handler(),{action:"status",reference:"tampered"})).code,400);
 const wrong=await new SignJWT({attempt:{amount:1}}).setProtectedHeader({alg:"HS256"}).setIssuer("ev-cms-sso").setAudience("ev-cms-mobile").setSubject(user).setExpirationTime("1h").sign(key());
 assert.equal((await call(handler(),{action:"status",reference:wrong})).code,400);
});
test("timeout returns signed ambiguous reference and blocks retrying it",async()=>{
 let calls=0;
 const h=handler({request:async()=>{calls++;throw Error("timeout");}});
 const reference=await prepare(h);
 const failed=await call(h,{action:"create",reference,confirmRealPayment:true});
 assert.equal(failed.code,503);assert.ok(failed.body.reference);assert.equal(failed.body.attempt.creationState,"unknown");
 assert.equal((await call(h,{action:"create",reference:failed.body.reference,confirmRealPayment:true})).code,409);
 assert.equal(calls,1);
});
test("explicitly confirmed no-order retry preserves the old reference and prepares a fresh order",async()=>{
 let creates=0;
 const h=handler({request:async(url)=>{
  assert.ok(url.endsWith("/Payment/SavePaymentData"));
  creates++;
  if(creates===1)return new Response("forbidden",{status:403,headers:{"Content-Type":"text/html"}});
  return Response.json({orderId:"ORDER123456",paymentUrl:"https://epay.dfccil.com/Payment/Pay/ORDER123456"});
 }});
 const first=await call(h,{action:"create",reference:await prepare(h),confirmRealPayment:true});
 assert.equal(first.body.attempt.creationState,"unknown");
 const noConfirmation=await call(h,{action:"retry",reference:first.body.reference,confirmRealPayment:true});
 assert.equal(noConfirmation.code,409);
 assert.equal(creates,1);
 const prepared=await call(h,{action:"retry",reference:first.body.reference,confirmRealPayment:true,confirmNoExistingOrder:true});
 assert.equal(prepared.code,200);
 assert.equal(prepared.body.attempt.creationState,"reserved");
 assert.notEqual(prepared.body.attempt.attemptId,first.body.attempt.attemptId);
 assert.equal(creates,1);
 const second=await call(h,{action:"create",reference:prepared.body.reference,confirmRealPayment:true});
 assert.equal(second.code,200);
 assert.equal(second.body.attempt.canOpenCheckout,true);
 assert.equal(creates,2);
 const old=await call(h,{action:"status",reference:first.body.reference});
 assert.equal(old.body.attempt.attemptId,first.body.attempt.attemptId);
 assert.equal(old.body.attempt.creationState,"unknown");
});
test("status rejects mismatched amount and leaves payment unverified",async()=>{
 let stage="create";
 const h=handler({request:async()=>stage==="create"?Response.json({orderId:"ORDER123456",paymentUrl:"https://epay.dfccil.com/Payment/Pay/ORDER123456"}):Response.json({orderId:"ORDER123456",appId:"EV001",amount:2,status:"CHARGED",statusGroup:"SUCCESS"})});
 const created=await call(h,{action:"create",reference:await prepare(h),confirmRealPayment:true});
 stage="status";
 const checked=await call(h,{action:"status",reference:created.body.reference});
 assert.equal(checked.code,502);assert.equal(checked.body.attempt.verified,false);
});

test("diagnostics only perform a GET status probe and never create an order", async () => {
 let calls=0;
 const h=handler({request:async(url,init)=>{
  calls++;assert.equal(init.method,"GET");
  assert.equal(url,"https://epay.dfccil.com/Payment/Status/EV-CMS-CONNECTIVITY-CHECK");
  assert.equal(init.headers["mobile-epay"],mobileEpayHeader);
  return new Response("blocked",{status:403,headers:{"Content-Type":"text/html"}});
 }});
 const result=await call(h,{action:"diagnose"});
 assert.equal(result.code,200);assert.equal(result.body.diagnostics.httpStatus,403);
 assert.equal(calls,1);assert.equal(result.body.reference,undefined);
});
test("diagnostics do not call the gateway when the server-only credential is absent", async () => {
 let calls = 0;
 const h = handler({ env: () => ({ DFCCIL_PRODUCTION_TEST_ENABLED: "true" }), request: async () => { calls++; } });
 const result = await call(h, { action: "diagnose" });
 assert.equal(result.code, 503);
 assert.match(result.body.error, /authentication is not configured/i);
 assert.equal(calls, 0);
});
test("diagnostics report transport codes without exposing upstream error messages", async () => {
 const h=handler({request:async()=>{throw new TypeError("secret upstream data",{cause:{code:"CERT_HAS_EXPIRED"}});}});
 const result=await call(h,{action:"diagnose"});
 assert.equal(result.body.diagnostics.code,"CERT_HAS_EXPIRED");
 assert.equal(JSON.stringify(result.body).includes("secret upstream data"),false);
});
