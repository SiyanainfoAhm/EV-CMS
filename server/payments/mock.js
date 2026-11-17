import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { authenticate, bearer, sessionKey } from "../sso/sessions.js";

// Separate issuer/audience prevents a mock reference from becoming an application session.
export function mockPaymentHandler({ authorize = authenticate, key = sessionKey,
  enabled = () => process.env.PAYMENT_MOCK_ENABLED === "true" } = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    let auth;
    try { auth = await authorize(bearer(req)); }
    catch { return res.status(401).json({ error: "Sign in again." }); }
    if (!enabled()) return res.status(503).json({ error: "Payment mock is disabled. Enable PAYMENT_MOCK_ENABLED on the backend." });
    const body = req.body || {};
    if (!["create", "status", "resolve"].includes(body.action)) return res.status(400).json({ error: "Invalid mock action" });
    try {
      let attempt;
      if (body.action === "create") {
        attempt = { attemptId: `MOCK-${randomUUID()}`, amount: 1, currency: "INR", status: "pending", createdAt: new Date().toISOString() };
      } else {
        const { payload } = await jwtVerify(body.reference, key(), {
          algorithms: ["HS256"], issuer: "ev-cms-payment-mock", audience: "ev-cms-payment-mock",
        });
        if (payload.sub !== auth.user.id) throw new Error("Wrong owner");
        attempt = payload.attempt;
        if (body.action === "resolve") {
          if (!["paid", "failed", "cancelled", "pending"].includes(body.outcome)) return res.status(400).json({ error: "Invalid outcome" });
          if (attempt.status !== "pending") return res.status(409).json({ error: "Create another mock order to test a different outcome." });
          attempt = { ...attempt, status: body.outcome };
        }
      }
      const reference = await new SignJWT({ attempt }).setProtectedHeader({ alg: "HS256" })
        .setIssuer("ev-cms-payment-mock").setAudience("ev-cms-payment-mock")
        .setSubject(auth.user.id).setIssuedAt().setExpirationTime("24h").sign(key());
      return res.status(200).json({ mock: true, reference, attempt: { ...attempt, verified: attempt.status === "paid", canOpenCheckout: attempt.status === "pending" } });
    } catch { return res.status(400).json({ error: "Invalid or expired mock reference. Create another mock order." }); }
  };
}
