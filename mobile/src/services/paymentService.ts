import {
  canUseRazorpayBackend,
  isRazorpayClientConfigured,
  isRazorpayGateway,
  isRazorpayPaymentReady,
  paymentConfig,
} from "../config/paymentConfig";
import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import {
  openRazorpayCheckout,
  isRazorpayUserCancelled,
  isRazorpayNativeAvailable,
  type CreateRazorpayOrderResponse,
  type RazorpayCheckoutOptions,
} from "./razorpayService";
import * as sessionPaymentService from "./sessionPaymentService";
import type { Payment } from "../types";

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
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as Record<string, unknown>;
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
