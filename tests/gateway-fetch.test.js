import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { createGatewayFetch } from "../server/payments/gateway-fetch.js";
import { globalsignIntermediate } from "../server/payments/globalsign-intermediate.js";
function stub(status=200, body='{"ok":true}', inspect=()=>{}) {
 return (url,options,callback)=>{
  inspect(url,options);
  const req=new EventEmitter();req.setTimeout=()=>req;
  req.end=()=>queueMicrotask(()=>{
   const response=Readable.from([Buffer.from(body)]);
   response.statusCode=status;response.headers={"content-type":"application/json"};callback(response);
  });return req;
 };
}
test("intermediate fingerprint, CA purpose, signature and validity are verified",()=>{
 const cert=new X509Certificate(globalsignIntermediate);
 assert.equal(cert.ca,true);
 assert.equal(cert.fingerprint256,"D1:60:E2:DE:4E:56:CB:10:B6:6C:1C:B0:AD:CB:79:CF:93:C7:8D:CD:9D:B3:0C:20:18:22:02:62:C0:40:63:F9");
 const root=rootCertificates.map(pem=>new X509Certificate(pem)).find(c=>c.subject===cert.issuer);
 assert.ok(root);assert.equal(cert.verify(root.publicKey),true);
 assert.ok(Date.now()>Date.parse(cert.validFrom));assert.ok(Date.now()<Date.parse(cert.validTo));
});
test("gateway agent preserves validation, root trust and request timeout signal",async()=>{
 const signal=AbortSignal.timeout(1000);
 const fetch=createGatewayFetch({request:stub(200,'{"ok":true}',(url,options)=>{
  assert.equal(url.hostname,"epay.dfccil.com");assert.equal(options.agent.options.rejectUnauthorized,true);
  assert.equal(options.agent.options.checkServerIdentity,undefined);
  assert.ok(options.agent.options.ca.includes(globalsignIntermediate));
  assert.ok(rootCertificates.every(c=>options.agent.options.ca.includes(c)));
  assert.equal(options.signal,signal);assert.equal(options.headers["accept-encoding"],"identity");
 })});
 assert.deepEqual(await (await fetch("https://epay.dfccil.com/Payment/Status/test",{signal})).json(),{ok:true});
});
test("custom CA is not used for another origin or an HTTP URL",async()=>{
 let calls=0;
 const fetch=createGatewayFetch({request:()=>{throw Error("wrong transport");},fallback:async()=>{calls++;return new Response("ok");}});
 await fetch("https://other.example/");await fetch("http://epay.dfccil.com/");assert.equal(calls,2);
});
test("gateway redirects fail closed and HTTP error codes remain available",async()=>{
 await assert.rejects(createGatewayFetch({request:stub(302)})("https://epay.dfccil.com/"),/redirects/);
 const r=await createGatewayFetch({request:stub(403,"blocked")})("https://epay.dfccil.com/");
 assert.equal(r.status,403);assert.equal(await r.text(),"blocked");
});
test("gateway URL credentials are rejected",async()=>{
 await assert.rejects(createGatewayFetch()("https://user:password@epay.dfccil.com/"),/credentials/);
});
