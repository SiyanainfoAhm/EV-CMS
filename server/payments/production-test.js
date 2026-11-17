import { authenticate, bearer, database } from "../sso/sessions.js";
import { configuration, PaymentError, publicAttempt, submitReservedPayment, verifyPaymentStatus, uuid } from "./dfccil.js";

export class ProductionTestStore {
  constructor(db) { this.db = db; }
  async rpc(name, args) {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw new PaymentError("Production test storage is not ready. Contact support before retrying.", 503);
    return data;
  }
  async latest(userId) {
    const { data, error } = await this.db.from("EV_DfccilProductionTests").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw new PaymentError("Production test storage is not ready.", 503);
    return data;
  }
  async update(id, values) {
    const { error } = await this.db.from("EV_DfccilProductionTests").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new PaymentError("Could not save payment reference. Do not create another order.", 503);
  }
  claimStatus(auth, id) { return this.rpc("ev_dfccil_test_claim", { p_user_id: auth.user.id, p_id: id }); }
  finalizeStatus(a, result) { return this.rpc("ev_dfccil_test_finalize", { p_id: a.id, p_token: a.status_check_token, p_result: result }); }
  async reported(orderId, status) {
    const { data, error } = await this.db.from("EV_DfccilProductionTests").select("id,verified_at").eq("order_id", orderId).maybeSingle();
    if (error || !data) throw new PaymentError("Payment not found", 404);
    // The unsigned return is navigation only. Only the status verifier may mark paid.
    await this.update(data.id, { reported_status: status });
    return { attemptId: data.id, verified: Boolean(data.verified_at), productionTest: true };
  }
}

export function productionTestHandler({ authorize = authenticate, db = database,
  env = () => process.env, request = fetch } = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    let auth;
    try { auth = await authorize(bearer(req)); } catch { return res.status(401).json({ error: "Sign in again." }); }
    try {
      if (auth.user.role !== "User" || !uuid.test(auth.claims.virtualId || "")) throw new PaymentError("An active DFCCIL user account is required.", 403);
      const input = req.body || {};
      if (!["create", "status"].includes(input.action) || Object.keys(input).some(k => !["action", "confirmRealPayment"].includes(k))) throw new PaymentError("Invalid request");
      const settings = env();
      const config = configuration(settings);
      // Keep the registered return URL, but never allow this test to target another gateway.
      if (config.baseUrl !== "https://epay.dfccil.com") throw new PaymentError("Production DFCCIL gateway configuration required.", 503);
      if (input.action === "create") {
        if (settings.DFCCIL_PRODUCTION_TEST_ENABLED !== "true") throw new PaymentError("Production payment test is disabled.", 503);
        if (input.confirmRealPayment !== true) throw new PaymentError("Confirm the real ₹1 payment first.");
      }
      const store = new ProductionTestStore(db());
      let a;
      if (input.action === "create") {
        const reserved = await store.rpc("ev_dfccil_test_reserve", { p_user_id: auth.user.id, p_virtual_id: auth.claims.virtualId, p_app_id: config.appId, p_nature_id: config.natureId });
        a = reserved?.attempt;
        if (!a || a.user_id !== auth.user.id || Number(a.amount) !== 1) throw new PaymentError("Invalid test reservation", 503);
        if (reserved.created) {
          const attempt = await submitReservedPayment(auth, a, store, config, request, "EV-CMS standalone production verification payment (INR 1)");
          return res.status(200).json({ productionTest: true, attempt });
        }
      } else { a = await store.latest(auth.user.id); }
      a = await verifyPaymentStatus(auth, a, store, config, request);
      return res.status(200).json({ productionTest: true, attempt: publicAttempt(a) });
    } catch (e) { return res.status(e.status || 503).json({ error: e.status ? e.message : "Production test unavailable. Check status before retrying." }); }
  };
}
