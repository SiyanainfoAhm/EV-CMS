export class PaymentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const CLIENT_ID = "f51c3d26cd09487eb2350a9742b8af18";
export const RETURN_URI = "in.dfccil.evcms://payments/dfccil/return";
export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const validOrder = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
export function configuration(env = process.env) {
  const baseUrl = env.DFCCIL_PAYMENT_BASE_URL || "https://epay.dfccil.com";
  const appId = env.DFCCIL_PAYMENT_APP_ID || "EV001";
  const natureId = Number(env.DFCCIL_NATURE_OF_PAYMENT_ID || 30);
  const returnUrl =
    env.DFCCIL_PAYMENT_RETURN_URL ||
    "https://ev-cms-rho.vercel.app/api/payments/dfccil/return";
  for (const value of [baseUrl, returnUrl]) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new PaymentError("Payment configuration is invalid", 503);
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      throw new PaymentError(
        "Payment configuration requires fixed HTTPS URLs",
        503,
      );
  }
  if (!appId || !Number.isInteger(natureId) || natureId <= 0)
    throw new PaymentError("Payment configuration is invalid", 503);
  return {
    enabled: env.DFCCIL_PAYMENTS_ENABLED === "true",
    baseUrl: baseUrl.replace(/\/$/, ""),
    appId,
    natureId,
    returnUrl,
  };
}
export function checkoutUrl(orderId, returnedUrl, config) {
  if (!validOrder(orderId))
    throw new PaymentError("Gateway returned an invalid order reference", 502);
  const expected = `${config.baseUrl}/Payment/Pay/${encodeURIComponent(orderId)}`;
  if (typeof returnedUrl !== "string" || returnedUrl.trim() !== expected)
    throw new PaymentError("Gateway returned an unexpected checkout URL", 502);
  return expected;
}
export function publicAttempt(row) {
  if (!row) return null;
  const paid = row.resolution === "paid" && Boolean(row.verified_at);
  return {
    attemptId: row.id,
    sessionId: row.session_id,
    paymentId: row.payment_id,
    orderId: row.order_id,
    amount: Number(row.amount),
    creationState: row.creation_state,
    reportedStatus: row.reported_status,
    status: paid
      ? "paid"
      : row.resolution === "failed" || row.resolution === "cancelled"
        ? row.resolution
        : row.reported_status
          ? "pending_verification"
          : row.creation_state === "unknown" ||
              row.creation_state === "reserved"
            ? "creation_pending"
            : row.creation_state === "rejected"
              ? "failed"
              : "pending",
    verified: paid,
    canOpenCheckout:
      row.creation_state === "ready" &&
      (!row.reported_status || (row.reported_status === "INITIATED" && row.gateway_status === "INITIATED")) &&
      row.resolution === "open",
    checkoutUrl:
      row.creation_state === "ready" &&
      (!row.reported_status || (row.reported_status === "INITIATED" && row.gateway_status === "INITIATED")) &&
      row.resolution === "open"
        ? row.checkout_url
        : null,
    createdAt: row.created_at,
  };
}
export class AttemptStore {
  constructor(db) {
    this.db = db;
  }
  async reserve(auth, sessionId, config) {
    const { data, error } = await this.db.rpc("ev_dfccil_prepare_payment", {
      p_user_id: auth.user.id,
      p_virtual_id: auth.claims.virtualId,
      p_session_id: sessionId,
      p_app_id: config.appId,
      p_client_id: CLIENT_ID,
      p_nature_id: config.natureId,
    });
    if (error) {
      const messages = {
        BILL_ALREADY_PAID: "This bill is already paid.",
        BILL_NOT_FINAL: "Payment is available after charging has ended.",
        BILL_REQUIRES_RECONCILIATION:
          "This bill needs reconciliation before another payment.",
        ANOTHER_PAYMENT_PENDING: "Another payment for this bill is pending.",
        INVALID_BILL: "The final bill could not be calculated.",
        BILL_TARIFF_MISSING: "A billing tariff must be configured.",
      };
      const key = Object.keys(messages).find((k) => error.message?.includes(k));
      throw new PaymentError(
        key
          ? messages[key]
          : "Payment storage is not ready. Contact your administrator.",
        key ? 409 : 503,
      );
    }
    return data;
  }
  async update(id, values) {
    const { error } = await this.db
      .from("EV_DfccilPaymentAttempts")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error)
      throw new PaymentError(
        "Payment reference could not be saved. Do not create another payment; contact support.",
        503,
      );
  }
  async latest(auth, { sessionId, attemptId }) {
    let query = this.db
      .from("EV_DfccilPaymentAttempts")
      .select("*")
      .eq("user_id", auth.user.id);
    query = attemptId
      ? query.eq("id", attemptId)
      : query.eq("session_id", sessionId);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error)
      throw new PaymentError(
        "Online payment is not available yet. Contact your administrator.",
        503,
      );
    return data;
  }
  async claimStatus(auth, attemptId) {
    const { data, error } = await this.db.rpc("ev_dfccil_claim_status", {
      p_attempt_id: attemptId, p_user_id: auth.user.id,
    });
    if (error) throw new PaymentError("Payment verification storage is not ready.", 503);
    return data;
  }
  async finalizeStatus(a, result) {
    const { data, error } = await this.db.rpc("ev_dfccil_finalize_status", {
      p_attempt_id: a.id, p_check_token: a.status_check_token, p_result: result,
    });
    if (error) throw new PaymentError("Payment could not be reconciled. Contact support before paying again.", 503);
    return data;
  }
  async reported(orderId, status) {
    const { data, error } = await this.db.rpc("ev_dfccil_record_return", {
      p_order_id: orderId,
      p_status: status,
    });
    if (error)
      throw new PaymentError(
        "Could not record the payment result. Check the app before retrying.",
        503,
      );
    if (!data) throw new PaymentError("Payment reference not found", 404);
    return data;
  }
}
export async function createPayment(
  auth,
  input,
  store,
  config = configuration(),
  request = fetch,
) {
  if (!config.enabled)
    throw new PaymentError("Online payments are not enabled yet.", 503);
  if (auth.user.role !== "User")
    throw new PaymentError(
      "Only the bill owner can start a mobile payment.",
      403,
    );
  if (
    !input ||
    Object.keys(input).some((k) => k !== "sessionId") ||
    !uuid.test(input.sessionId || "") ||
    !uuid.test(auth.claims.virtualId || "")
  )
    throw new PaymentError("Invalid payment request");
  const reserved = await store.reserve(auth, input.sessionId, config);
  if (!reserved?.attempt)
    throw new PaymentError("Payment storage returned an invalid result", 503);
  const a = reserved.attempt;
  if (
    a.user_id !== auth.user.id ||
    a.session_id !== input.sessionId ||
    !Number.isFinite(Number(a.amount)) ||
    Number(a.amount) <= 0
  )
    throw new PaymentError("Payment reservation does not match the bill", 503);
  if (!reserved.created) return publicAttempt(a); // Never retry ambiguous or already-created external orders.
  let orderId;
  try {
    const response = await request(
      `${config.baseUrl}/Payment/SavePaymentData`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          AppId: config.appId,
          ClientId: CLIENT_ID,
          VirtualId: auth.claims.virtualId,
          Amount: Number(a.amount),
          Description: `EV charging bill ${a.session_id}`,
          NatureOfPaymentId: String(config.natureId),
          ReturnUrl: config.returnUrl,
        }),
      },
    );
    if (!response.ok) {
      const problem = response.status === 400 && response.headers.get("content-type")?.includes("application/problem+json")
        ? await response.json().catch(() => ({})) : {};
      // Only documented pre-order validation errors are safe to retry as new orders.
      // Rate limits, proxy errors and unknown 4xx responses may be ambiguous.
      const rejected = response.status === 400 && typeof problem.detail === "string" &&
        /AppId is required|Unknown AppId|This AppId is disabled|ReturnUrl is not allowed for this AppId|A valid absolute ReturnUrl is required|ClientId and VirtualId are required for this app|VirtualId is not valid|ClientId is not valid|Virtual ID was not found|This virtual ID is not active|not registered for virtual ID|NatureOfPaymentId is required for this app|NatureOfPaymentId .* is not mapped to this app/i.test(problem.detail);
      await store.update(a.id, {
        creation_state: rejected ? "rejected" : "unknown",
        resolution: rejected ? "failed" : "open",
        error_kind: `http_${response.status}`,
      });
      return publicAttempt({
        ...a,
        creation_state: rejected ? "rejected" : "unknown",
        resolution: rejected ? "failed" : "open",
      });
    }
    const result = await response.json();
    orderId = result.orderId;
    const url = checkoutUrl(orderId, result.paymentUrl, config);
    await store.update(a.id, {
      order_id: orderId,
      checkout_url: url,
      creation_state: "ready",
    });
    return publicAttempt({
      ...a,
      order_id: orderId,
      checkout_url: url,
      creation_state: "ready",
    });
  } catch (error) {
    try {
      await store.update(a.id, {
        creation_state: "unknown",
        error_kind: "creation_unconfirmed",
        ...(validOrder(orderId) ? { order_id: orderId } : {}),
      });
    } catch {
      console.error("[dfccil-payment] persistence requires reconciliation", {
        attemptId: a.id,
        orderId: validOrder(orderId) ? orderId : undefined,
      });
    }
    throw new PaymentError(
      "The payment request could not be confirmed. Check its status before trying again.",
      503,
    );
  }
}
export async function recordReturn(url, store) {
  const params = new URL(url, "https://callback.invalid").searchParams;
  if (
    params.getAll("orderId").length !== 1 ||
    params.getAll("txnStatus").length !== 1 ||
    !validOrder(params.get("orderId"))
  )
    throw new PaymentError("Invalid payment return");
  const value = params.get("txnStatus");
  const status = [
    "CHARGED",
    "CANCELLED",
    "FAILED",
    "TIMEOUT",
    "AMOUNT_MISMATCH",
    "INITIATED",
    "PaymentLinkUsed",
  ].includes(value)
    ? value
    : "UNKNOWN";
  return store.reported(params.get("orderId"), status);
}
export async function receipt(
  auth,
  attemptId,
  store,
  config = configuration(),
  request = fetch,
) {
  if (!uuid.test(attemptId || ""))
    throw new PaymentError("Invalid payment reference");
  const a = await store.latest(auth, { attemptId });
  if (!a || a.user_id !== auth.user.id)
    throw new PaymentError("Payment not found", 404);
  if (a.resolution !== "paid" || !a.verified_at || !validOrder(a.order_id))
    throw new PaymentError(
      "The receipt is available after payment has been verified.",
      409,
    );
  const result = await request(
    `${config.baseUrl}/Payment/GetReceipt/${encodeURIComponent(a.order_id)}`,
    { redirect: "error", signal: AbortSignal.timeout(15000) },
  );
  if (
    !result.ok ||
    !result.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/pdf")
  )
    throw new PaymentError(
      "Gateway receipt is not available. Please retry later.",
      502,
    );
  const reader = result.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 5 * 1024 * 1024) {
      await reader.cancel();
      throw new PaymentError("Receipt exceeds the supported size", 502);
    }
    chunks.push(Buffer.from(value));
  }
  const pdf = Buffer.concat(chunks);
  if (pdf.subarray(0, 5).toString() !== "%PDF-")
    throw new PaymentError("Invalid receipt response", 502);
  return pdf;
}

// Only this server-to-server HTTPS response can authorize financial finalization.
export async function verifyPaymentStatus(auth, attempt, store, config = configuration(), request = fetch) {
  if (!attempt) return null;
  if (attempt.user_id !== auth.user.id) throw new PaymentError("Payment not found", 404);
  if (!attempt.order_id || attempt.resolution === "paid") return attempt;
  const claimed = await store.claimStatus(auth, attempt.id);
  const a = claimed?.attempt;
  if (!a || a.user_id !== auth.user.id || a.id !== attempt.id)
    throw new PaymentError("Invalid payment verification record", 503);
  if (!claimed.check) return a;
  if (!validOrder(a.order_id) || a.app_id !== config.appId)
    throw new PaymentError("Invalid payment verification reference", 503);
  let result;
  try {
    const response = await request(`${config.baseUrl}/Payment/Status/${encodeURIComponent(a.order_id)}`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Status service unavailable");
    result = await response.json();
  } catch {
    throw new PaymentError("Gateway status could not be checked. Wait 30 seconds and refresh; do not pay again.", 502);
  }
  const validStatus = result && (
    (result.statusGroup === "SUCCESS" && result.status === "CHARGED") ||
    (result.statusGroup === "FAILED" && ["FAILED", "CANCELLED", "TIMEOUT", "AMOUNT_MISMATCH"].includes(result.status)) ||
    (result.statusGroup === "PENDING" && ["INITIATED", "PaymentLinkUsed"].includes(result.status)));
  if (!validStatus || result.orderId !== a.order_id || result.appId !== a.app_id ||
      typeof result.amount !== "number" || !Number.isFinite(result.amount) ||
      result.amount <= 0 || result.amount !== Number(a.amount) ||
      (result.hasReceipt !== undefined && typeof result.hasReceipt !== "boolean"))
    throw new PaymentError("Gateway payment details do not match this bill. Contact support before paying again.", 502);
  return store.finalizeStatus(a, {
    orderId: result.orderId, appId: result.appId, amount: result.amount,
    status: result.status, statusGroup: result.statusGroup, hasReceipt: result.hasReceipt === true,
  });
}
