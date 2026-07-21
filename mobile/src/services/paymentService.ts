import {
  canUseRazorpayBackend,
  isRazorpayClientConfigured,
  isRazorpayGateway,
  isRazorpayPaymentReady,
  paymentConfig,
} from "../config/paymentConfig";
import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import * as chargingService from "./chargingService";
import { assertChargerOnlineForMobile } from "./chargerService";
import * as sessionService from "./sessionService";
import {
  openRazorpayCheckout,
  isRazorpayUserCancelled,
  isRazorpayNativeAvailable,
  type CreateRazorpayOrderResponse,
  type RazorpayCheckoutOptions,
} from "./razorpayService";
import * as sessionPaymentService from "./sessionPaymentService";
import { isPrepaidSession } from "../utils/sessionCompletion";
import type { Payment, PrepaidPaymentCalculation } from "../types";
import type { PrepaidPaymentOrderPayload } from "../utils/prepaidPayment";

export type RazorpaySessionPaymentResult = {
  paymentId: string;
  sessionId: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  status: string;
  receiptNumber?: string | null;
  cancelled?: boolean;
  checkoutFailed?: boolean;
  errorMessage?: string;
};

export interface SessionPaymentSummary {
  paymentId: string;
  sessionId: string;
  amount: number;
  gstAmount: number;
  totalAmount: number;
  status: string;
  amountDue: number;
  gatewayOrderId?: string | null;
}

function mapSessionPaymentSummary(
  row: Record<string, unknown>,
  amountDueFromRpc?: number
): SessionPaymentSummary {
  const amount = Number(row.amount);
  const gstAmount = Number(row.gst_amount ?? 0);
  const totalAmount = Number(row.total_amount ?? amount + gstAmount);
  const status = String(row.status);
  const paid = status === "success" || status === "paid";
  const amountDue =
    amountDueFromRpc != null && !Number.isNaN(amountDueFromRpc)
      ? Number(amountDueFromRpc)
      : paid
        ? 0
        : totalAmount;

  return {
    paymentId: (row.payment_id ?? row.id) as string,
    sessionId: row.session_id as string,
    amount,
    gstAmount,
    totalAmount,
    status,
    amountDue,
    gatewayOrderId: row.gateway_order_id ? String(row.gateway_order_id) : null,
  };
}

function mapRazorpayCheckoutError(e: unknown): RazorpaySessionPaymentResult {
  if (isRazorpayUserCancelled(e)) {
    return {
      paymentId: "",
      sessionId: "",
      status: "cancelled",
      cancelled: true,
    };
  }

  const message = e instanceof Error ? e.message : "PAYMENT_FAILED";
  return {
    paymentId: "",
    sessionId: "",
    status: "failed",
    checkoutFailed: true,
    errorMessage: message,
  };
}

async function completeRazorpaySessionCheckout(
  sessionId: string,
  order: CreateRazorpayOrderResponse,
  checkoutOptions?: RazorpayCheckoutOptions
): Promise<RazorpaySessionPaymentResult> {
  try {
    const checkout = await openRazorpayCheckout(order, checkoutOptions);

    const verified = await sessionPaymentService.verifyRazorpaySessionPayment({
      payment_order_id: order.payment_order_id,
      razorpay_order_id: checkout.razorpay_order_id ?? order.razorpay_order_id,
      razorpay_payment_id: checkout.razorpay_payment_id,
      razorpay_signature: checkout.razorpay_signature ?? "",
    });

    return {
      paymentId: verified.payment_id,
      sessionId: verified.session_id ?? sessionId,
      razorpayOrderId: verified.gateway_order_id ?? order.razorpay_order_id,
      razorpayPaymentId: verified.gateway_payment_id ?? checkout.razorpay_payment_id,
      status: verified.status,
      receiptNumber: verified.receipt_number,
    };
  } catch (e) {
    const failed = mapRazorpayCheckoutError(e);
    return {
      ...failed,
      paymentId: order.payment_order_id,
      sessionId,
      razorpayOrderId: order.razorpay_order_id,
    };
  }
}

export function checkGatewayConfigured(): boolean {
  if (!paymentConfig.gatewayEnabled) return false;
  if (isRazorpayGateway()) {
    return isRazorpayPaymentReady() || paymentConfig.mockEnabled;
  }
  return true;
}

export function isPaymentMockEnabled(): boolean {
  return paymentConfig.mockEnabled;
}

export function isRazorpayPaymentEnabled(): boolean {
  return isRazorpayPaymentReady();
}

export function canOpenRazorpayCheckout(): boolean {
  return isRazorpayPaymentReady() && isRazorpayNativeAvailable();
}

export function getGatewayPendingMessage(): string {
  if (!paymentConfig.gatewayEnabled) {
    return "razorpay.gatewayNotConfigured";
  }
  if (isRazorpayGateway() && !isRazorpayClientConfigured()) {
    return "razorpay.keyMissing";
  }
  if (isRazorpayGateway() && !canUseRazorpayBackend()) {
    return "razorpay.gatewayNotConfigured";
  }
  return "razorpay.title";
}

export async function getPaymentHistory(userId?: string): Promise<Payment[]> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_Payments")
    .select("*, EV_Receipts ( id, receipt_number, pdf_url, issued_at )")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const receipts = (r.EV_Receipts as Record<string, unknown>[]) ?? [];
    const receipt = receipts[0];
    return {
      id: r.id as string,
      sessionId: r.session_id as string,
      totalAmount: Number(r.total_amount ?? r.amount),
      status: r.status as string,
      createdAt: r.created_at as string,
      receiptNumber: receipt ? (receipt.receipt_number as string) : undefined,
      receiptPdfUrl: receipt?.pdf_url ? (receipt.pdf_url as string) : undefined,
    };
  });
}

export async function getSessionPayment(sessionId: string, userId?: string): Promise<SessionPaymentSummary | null> {
  const uid = userId ?? requireUserId();
  try {
    await sessionPaymentService.syncSessionPaymentBill(sessionId);
  } catch {
    // RPC may not exist until SESSION_RAZORPAY_PAYMENT.sql is applied.
  }

  // Client-side prepaid gate — even if a stale pending payment row exists.
  try {
    const session = await sessionService.getSessionById(sessionId, uid);
    if (session && isPrepaidSession(session)) {
      const paid = await getSessionPaymentFallback(sessionId, uid);
      if (paid) {
        return {
          ...paid,
          amountDue: 0,
          status: paid.status === "pending" ? "paid" : paid.status,
        };
      }
    }
  } catch {
    // continue with RPC / fallback
  }

  const { data, error } = await requireSupabase().rpc("ev_get_session_payment", {
    p_user_id: uid,
    p_session_id: sessionId,
  });
  if (error) {
    if (error.code === "42883" || error.message?.includes("ev_get_session_payment")) {
      return getSessionPaymentFallback(sessionId, uid);
    }
    throw error;
  }
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return getSessionPaymentFallback(sessionId, uid);
  return mapSessionPaymentSummary(row, Number(row.amount_due));
}

async function getSessionPaymentFallback(sessionId: string, userId: string): Promise<SessionPaymentSummary | null> {
  const { data, error } = await requireSupabase()
    .from("EV_Payments")
    .select("id, session_id, amount, gst_amount, total_amount, status, gateway, gateway_txn_id")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  const rows = (data as Record<string, unknown>[] | null) ?? [];
  if (rows.length === 0) return null;

  const paid = rows.find((r) => {
    const status = String(r.status);
    return status === "success" || status === "paid";
  });
  const row = paid ?? rows[0];

  const summary = mapSessionPaymentSummary({
    payment_id: row.id,
    session_id: row.session_id,
    amount: row.amount,
    gst_amount: row.gst_amount,
    total_amount: row.total_amount,
    status: row.status,
    gateway_order_id:
      row.gateway === "razorpay" && row.status === "pending" ? row.gateway_txn_id : null,
  });

  // Prefer paid rows as amount_due = 0 even if a newer pending row exists (legacy double-bill).
  if (paid) {
    summary.amountDue = 0;
  }

  return summary;
}

export async function processRazorpaySessionPayment(sessionId: string): Promise<RazorpaySessionPaymentResult> {
  const order = await sessionPaymentService.createRazorpaySessionOrder(sessionId);
  return completeRazorpaySessionCheckout(sessionId, order, {
    description: "Charging session payment",
    purpose: "session_payment",
    sessionId,
  });
}

export type CreateRazorpaySessionPaymentInput = {
  chargerId: string;
  connectorId: number;
  userId?: string;
  calculation: PrepaidPaymentCalculation;
  paymentPayload: PrepaidPaymentOrderPayload;
  tariffId?: string;
};

/**
 * Prepaid flow: start session → attach prepaid payment → Razorpay checkout → verify.
 * Does not use wallet tables.
 */
export async function createRazorpaySessionPayment(
  input: CreateRazorpaySessionPaymentInput
): Promise<RazorpaySessionPaymentResult & { sessionId: string }> {
  const payload = input.paymentPayload;
  const prepaidValue =
    payload.plan_mode === "amount"
      ? payload.custom_amount ?? payload.base_amount
      : payload.duration_minutes;

  const options = chargingService.buildPrepaidSessionOptions({
    mode: payload.plan_mode,
    planId: payload.plan_id,
    prepaidValue,
    calculation: input.calculation,
    tariffId: input.tariffId,
  });

  let sessionId = "";
  let rolledBack = false;

  const rollback = async () => {
    if (!sessionId || rolledBack) return;
    rolledBack = true;
    try {
      await chargingService.stopCharging(sessionId, input.userId);
    } catch {
      // best-effort
    }
  };

  try {
    await assertChargerOnlineForMobile(input.chargerId);

    const session = await chargingService.startCharging(
      input.chargerId,
      input.connectorId,
      input.userId,
      options
    );
    sessionId = session.id;

    await chargingService.attachPrepaidPaymentRecord(
      session.id,
      input.calculation,
      input.userId
    );

    // Persist order payload on the payment row when metadata column exists (non-fatal).
    try {
      const summary = await getSessionPayment(session.id, input.userId);
      if (summary?.paymentId) {
        await requireSupabase()
          .from("EV_Payments")
          .update({
            // Some deployments may not have metadata — ignore column errors below.
            updated_at: new Date().toISOString(),
          })
          .eq("id", summary.paymentId);
        console.log("[prepaid] payment order payload:", payload);
      }
    } catch {
      console.log("[prepaid] payment order payload:", payload);
    }

    if (!checkGatewayConfigured()) {
      throw new Error("Unable to create payment order");
    }
    if (!canOpenRazorpayCheckout() && !isPaymentMockEnabled()) {
      throw new Error("Unable to create payment order");
    }

    if (isPaymentMockEnabled() && !canOpenRazorpayCheckout()) {
      const summary = await getSessionPayment(session.id, input.userId);
      if (summary?.paymentId) {
        await requireSupabase()
          .from("EV_Payments")
          .update({
            status: "success",
            gateway: "mock",
            gateway_txn_id: `mock_${Date.now()}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", summary.paymentId);
        await chargingService.markSessionPrepaidPaid(
          session.id,
          summary.paymentId,
          input.userId
        );
      }
      return {
        paymentId: summary?.paymentId ?? "",
        sessionId: session.id,
        status: "success",
      };
    }

    const result = await processRazorpaySessionPayment(session.id);

    if (
      result.cancelled ||
      result.checkoutFailed ||
      (result.status !== "success" && result.status !== "paid")
    ) {
      await rollback();
      if (result.cancelled) throw new Error("Payment cancelled");
      throw new Error(result.errorMessage || "Payment failed");
    }

    if (result.paymentId) {
      await chargingService.markSessionPrepaidPaid(session.id, result.paymentId, input.userId);
    }

    return { ...result, sessionId: session.id };
  } catch (e) {
    await rollback();
    if (e instanceof Error) {
      if (
        /Unable to create payment order|Payment cancelled|Payment failed|Session could not|Connector|USER_INACTIVE|CHARGER/i.test(
          e.message
        )
      ) {
        throw e;
      }
      if (/Razorpay|PAYMENT|GATEWAY|ORDER|cancelled/i.test(e.message)) {
        throw new Error(/cancel/i.test(e.message) ? "Payment cancelled" : "Payment failed");
      }
      if (/not online|CHARGER_NOT_ONLINE/i.test(e.message)) {
        throw new Error("Cannot start charging because this charger is not online.");
      }
      throw new Error(sessionId ? "Session could not be started after payment" : e.message);
    }
    throw e;
  }
}

export async function resumeRazorpaySessionPayment(
  sessionId: string,
  paymentId: string,
  razorpayOrderId: string,
  amount: number
): Promise<RazorpaySessionPaymentResult> {
  const order: CreateRazorpayOrderResponse = {
    payment_order_id: paymentId,
    razorpay_order_id: razorpayOrderId,
    amount,
    amount_paise: Math.round(amount * 100),
    currency: "INR",
    key_id: paymentConfig.razorpayKeyId,
    status: "pending",
  };

  if (!order.key_id) {
    throw new Error("RAZORPAY_KEY_MISSING");
  }

  return completeRazorpaySessionCheckout(sessionId, order, {
    description: "Charging session payment",
    purpose: "session_payment",
    sessionId,
  });
}

export type { CreateRazorpayOrderResponse };
