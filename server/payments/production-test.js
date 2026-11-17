import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { authenticate, bearer, sessionKey } from "../sso/sessions.js";
import { configuration, PaymentError, publicAttempt, submitReservedPayment, verifyPaymentStatus, uuid } from "./dfccil.js";

const TOKEN_SCOPE = "ev-cms-production-payment-test";
export function productionTestHandler({ authorize = authenticate, key = sessionKey,
  env = () => process.env, request = fetch } = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    let auth;
    try { auth = await authorize(bearer(req)); } catch { return res.status(401).json({ error: "Sign in again." }); }
    let a;
    const respond = async (status = 200, error) => {
      const reference = a ? await new SignJWT({ attempt: a, virtualId: auth.claims.virtualId })
        .setProtectedHeader({ alg: "HS256" }).setSubject(auth.user.id).setIssuer(TOKEN_SCOPE)
        .setAudience(TOKEN_SCOPE).setIssuedAt().setExpirationTime("7d").sign(key()) : null;
      return res.status(status).json({ productionTest: true, reference, attempt: publicAttempt(a), ...(error ? { error } : {}) });
    };
    try {
      if (auth.user.role !== "User" || !uuid.test(auth.claims.virtualId || "")) throw new PaymentError("An active DFCCIL user account is required.", 403);
      const input = req.body || {};
      if (!["prepare", "create", "status", "diagnose"].includes(input.action) || Object.keys(input).some(k => !["action", "confirmRealPayment", "reference"].includes(k))) throw new PaymentError("Invalid request");
      const settings = env();
      const config = configuration(settings);
      if (config.baseUrl !== "https://epay.dfccil.com") throw new PaymentError("Production DFCCIL gateway configuration required.", 503);
      if (input.action === "diagnose") {
        // Read-only status lookup for a deliberately invalid reference; never creates an order.
        try {
          const result = await request(`${config.baseUrl}/Payment/Status/EV-CMS-CONNECTIVITY-CHECK`, {
            method: "GET", redirect: "error", signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" },
          });
          const diagnostics = { httpStatus: result.status, contentType: result.headers.get("content-type")?.split(";")[0] || "unknown" };
          console.info(JSON.stringify({ event: "dfccil_connectivity_probe", ...diagnostics }));
          return res.status(200).json({ productionTest: true, diagnostics });
        } catch (error) {
          const code = /^[A-Z0-9_]{1,64}$/.test(error?.cause?.code || "") ? error.cause.code : "UNAVAILABLE";
          const diagnostics = { category: error?.name === "TimeoutError" ? "timeout" : "network", code };
          console.error(JSON.stringify({ event: "dfccil_connectivity_probe", ...diagnostics }));
          return res.status(200).json({ productionTest: true, diagnostics });
        }
      }
      if (input.reference) {
        let payload;
        try { ({ payload } = await jwtVerify(input.reference, key(), { algorithms: ["HS256"], issuer: TOKEN_SCOPE, audience: TOKEN_SCOPE, requiredClaims: ["sub", "exp", "iat"] })); }
        catch { throw new PaymentError("Invalid or expired test reference. Do not create another order; reconcile the existing payment first."); }
        if (payload.sub !== auth.user.id || payload.virtualId !== auth.claims.virtualId) throw new PaymentError("Payment reference belongs to another account.", 403);
        const saved = payload.attempt;
        if (!saved || saved.user_id !== auth.user.id || Number(saved.amount) !== 1 || saved.app_id !== config.appId) throw new PaymentError("Invalid test reference.");
        a = saved;
      }
      if (input.action === "prepare" || input.action === "create") {
        if (settings.DFCCIL_PRODUCTION_TEST_ENABLED !== "true") throw new PaymentError("Production payment test is disabled.", 503);
        if (input.confirmRealPayment !== true) throw new PaymentError("Confirm the real ₹1 payment first.");
      }
      if (input.action === "prepare") {
        if (a) throw new PaymentError("A test reference already exists. Check its status before paying again.", 409);
        a = { id: randomUUID(), user_id: auth.user.id, app_id: config.appId, amount: 1, creation_state: "reserved", resolution: "open", created_at: new Date().toISOString() };
        return await respond();
      }
      const store = {
        update: async (_id, values) => { a = { ...a, ...values }; },
        claimStatus: async () => ({ check: true, attempt: a }),
        finalizeStatus: async (_attempt, result) => {
          a = { ...a, gateway_status: result.status, reported_status: result.status,
            resolution: result.statusGroup === "SUCCESS" ? "paid" : result.status === "CANCELLED" ? "cancelled" : result.statusGroup === "FAILED" && result.status !== "AMOUNT_MISMATCH" ? "failed" : "open",
            verified_at: result.statusGroup === "SUCCESS" ? new Date().toISOString() : null };
          return a;
        },
      };
      if (input.action === "create") {
        if (!a || a.creation_state !== "reserved" || a.order_id) throw new PaymentError("A prepared test reference is required; do not retry an existing order.", 409);
        // No database ledger: the client must persist its creating marker before this request.
        a = { ...a, creation_state: "unknown" };
        await submitReservedPayment(auth, a, store, config, request, "EV-CMS standalone production verification payment (INR 1)");
      } else if (a) { a = await verifyPaymentStatus(auth, a, store, config, request); }
      return await respond();
    } catch (e) {
      return respond(e.status || 503, e.status ? e.message : "Production test unavailable. Do not retry order creation; check the existing reference.");
    }
  };
}
