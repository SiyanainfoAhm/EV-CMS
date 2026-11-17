import test from "node:test";
import assert from "node:assert/strict";
import { mockPaymentHandler } from "../server/payments/mock.js";
const key = () => new TextEncoder().encode("test-only-secret-of-at-least-32-bytes");
const handler = (id = "user-a", enabled = true) => mockPaymentHandler({ authorize: async () => ({ user: { id } }), key, enabled: () => enabled });
async function request(handle, body, method = "POST") {
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handle({ method, headers: { authorization: "Bearer fixture" }, body }, res);
  return res;
}
test("mock is disabled by configuration and requires authentication", async () => {
  assert.equal((await request(handler("a", false), { action: "create" })).code, 503);
  const h = mockPaymentHandler({ authorize: async () => { throw Error(); }, key, enabled: () => true });
  assert.equal((await request(h, { action: "create" })).code, 401);
});
test("create, restore, resolve and refresh all mock outcomes", async () => {
  for (const outcome of ["paid", "failed", "cancelled", "pending"]) {
    const h = handler();
    const created = await request(h, { action: "create", amount: 999 });
    assert.equal(created.body.attempt.amount, 1);
    assert.equal(created.body.mock, true);
    const restored = await request(h, { action: "status", reference: created.body.reference });
    assert.equal(restored.body.attempt.attemptId, created.body.attempt.attemptId);
    const resolved = await request(h, { action: "resolve", reference: restored.body.reference, outcome });
    assert.equal(resolved.body.attempt.status, outcome);
    assert.equal(resolved.body.attempt.verified, outcome === "paid");
    const refreshed = await request(h, { action: "status", reference: resolved.body.reference });
    assert.equal(refreshed.body.attempt.status, outcome);
    if (outcome !== "pending") assert.equal((await request(h, { action: "resolve", reference: resolved.body.reference, outcome: "paid" })).code, 409);
  }
});
test("rejects another user, tampered references and unknown outcomes", async () => {
  const created = await request(handler(), { action: "create" });
  assert.equal((await request(handler("other"), { action: "status", reference: created.body.reference })).code, 400);
  assert.equal((await request(handler(), { action: "status", reference: "invalid" })).code, 400);
  assert.equal((await request(handler(), { action: "resolve", reference: created.body.reference, outcome: "anything" })).code, 400);
  assert.equal((await request(handler(), {}, "GET")).code, 405);
});
