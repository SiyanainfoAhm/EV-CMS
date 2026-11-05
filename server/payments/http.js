import { authenticate, bearer, database } from "../sso/sessions.js";
import {
  AttemptStore,
  PaymentError,
  configuration,
  createPayment,
  publicAttempt,
  receipt,
  uuid,
  recordReturn,
  RETURN_URI,
  verifyPaymentStatus,
} from "./dfccil.js";
export async function protectedPayment(req, res, action) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  let auth;
  try {
    auth = await authenticate(bearer(req));
  } catch {
    return res
      .status(401)
      .json({ error: "Session expired or revoked. Sign in again." });
  }
  try {
    const config = configuration();
    const store = new AttemptStore(database());
    if (action === "config")
      return res
        .status(200)
        .json({
          enabled: config.enabled,
          provider: "dfccil",
          currency: "INR",
          verificationAvailable: true,
        });
    if (action === "create")
      return res
        .status(200)
        .json({ attempt: await createPayment(auth, req.body, store, config) });
    const input = req.body;
    if (action === "history") {
      const { data, error } = await store.db
        .from("EV_DfccilPaymentAttempts")
        .select("*")
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error)
        throw new PaymentError("Payment history is not available yet.", 503);
      return res
        .status(200)
        .json({ attempts: (data || []).map(publicAttempt) });
    }
    if (
      !input ||
      Object.keys(input).some((k) => !["sessionId", "attemptId"].includes(k)) ||
      Boolean(input.sessionId) === Boolean(input.attemptId) ||
      !uuid.test(input.sessionId || input.attemptId || "")
    )
      throw new PaymentError("Invalid payment reference");
    if (action === "status") {
      let a = await store.latest(auth, input);
      if (input.attemptId && !a)
        throw new PaymentError("Payment not found", 404);
      a = await verifyPaymentStatus(auth, a, store, config);
      return res
        .status(200)
        .json({ attempt: publicAttempt(a), enabled: config.enabled });
    }
    if (action === "receipt") {
      const pdf = await receipt(auth, input.attemptId, store, config);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="DFCCIL-payment-receipt.pdf"',
      );
      return res.status(200).send(pdf);
    }
    throw new PaymentError("Unknown payment operation");
  } catch (error) {
    return res
      .status(error.status || 503)
      .json({
        error:
          error instanceof PaymentError
            ? error.message
            : "Payment service is unavailable. Contact support before retrying.",
      });
  }
}
function html(message, link = "") {
  return (
    '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DFCCIL payment result</title><body><h1>Payment result</h1><p>' +
    message +
    "</p>" +
    (link ? '<p><a href="' + link + '">Return to EV-CMS</a></p>' : "") +
    "<p>Check the payment status in EV-CMS before making another payment.</p></body></html>"
  );
}
export async function returnPayment(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send(html("Method not allowed."));
  }
  try {
    const result = await recordReturn(req.url, new AttemptStore(database()));
    if (!uuid.test(result.attemptId || ""))
      throw new PaymentError("Invalid payment reference", 503);
    const target = new URL(RETURN_URI);
    target.searchParams.set("attemptId", result.attemptId);
    return res
      .status(200)
      .send(
        html(
          result.verified
            ? "Your payment is verified."
            : "The gateway return was received. Payment confirmation is pending verification.",
          target.toString().replaceAll("&", "&amp;"),
        ),
      );
  } catch (error) {
    return res
      .status(error.status || 503)
      .send(
        html(
          error.status === 404
            ? "Payment reference not found."
            : "The payment return could not be processed.",
        ),
      );
  }
}
