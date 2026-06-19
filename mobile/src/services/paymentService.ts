import { Linking } from "react-native";
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
} from "./razorpayService";
import * as walletService from "./walletService";
import type { Payment, PaymentOrder, TopupOrderResponse } from "../types";

export type RazorpayTopupResult = {
  paymentOrderId: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  status: string;
  walletCredited: boolean;
  cancelled?: boolean;
  checkoutFailed?: boolean;
  errorMessage?: string;
};

function mapRazorpayCheckoutError(e: unknown): RazorpayTopupResult {
  if (isRazorpayUserCancelled(e)) {
    return {
      paymentOrderId: "",
      status: "cancelled",
      walletCredited: false,
      cancelled: true,
    };
  }

  const message = e instanceof Error ? e.message : "PAYMENT_FAILED";
  return {
    paymentOrderId: "",
    status: "failed",
    walletCredited: false,
    checkoutFailed: true,
    errorMessage: message,
  };
}

async function completeRazorpayCheckout(
  order: CreateRazorpayOrderResponse
): Promise<RazorpayTopupResult> {
  try {
    const checkout = await openRazorpayCheckout(order);

    const verifyPayload = {
      payment_order_id: order.payment_order_id,
      razorpay_order_id: checkout.razorpay_order_id ?? order.razorpay_order_id,
      razorpay_payment_id: checkout.razorpay_payment_id,
      razorpay_signature: checkout.razorpay_signature ?? "",
    };

    const verified = await walletService.verifyRazorpayTopupPayment(verifyPayload);

    return {
      paymentOrderId: verified.payment_order_id,
      razorpayOrderId: verifyPayload.razorpay_order_id,
      razorpayPaymentId: verified.gateway_payment_id ?? checkout.razorpay_payment_id,
      status: verified.status,
      walletCredited: verified.wallet_credited,
    };
  } catch (e) {
    const failed = mapRazorpayCheckoutError(e);
    return {
      ...failed,
      paymentOrderId: order.payment_order_id,
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
      totalAmount: Number(r.total_amount),
      status: r.status as string,
      createdAt: r.created_at as string,
      receiptNumber: receipt ? (receipt.receipt_number as string) : undefined,
      receiptPdfUrl: receipt?.pdf_url ? (receipt.pdf_url as string) : undefined,
    };
  });
}

/** Create a top-up payment order (legacy Supabase RPC — used when mock/pending gateway). */
export async function createTopupPaymentOrder(
  amount: number,
  paymentMethod?: string
): Promise<TopupOrderResponse> {
  const gatewayName = checkGatewayConfigured()
    ? isRazorpayGateway()
      ? "razorpay"
      : paymentConfig.gatewayName
    : "dfccil_gateway_pending";
  const result = await walletService.createTopupOrder(amount, gatewayName);
  return {
    paymentOrderId: result.paymentOrderId,
    amount: result.amount,
    status: result.status,
    message: result.message,
  };
}

/** Full Razorpay top-up: create order → checkout → backend verify. */
export async function processRazorpayTopup(amount: number): Promise<RazorpayTopupResult> {
  const order = await walletService.createRazorpayTopupOrder(amount);
  return completeRazorpayCheckout(order);
}

/** Re-open Razorpay checkout for an existing pending order. */
export async function resumeRazorpayTopup(paymentOrderId: string): Promise<RazorpayTopupResult> {
  const status = await walletService.getPaymentOrderStatus(paymentOrderId);
  if (!status?.gatewayOrderId) {
    throw new Error("RAZORPAY_ORDER_MISSING");
  }

  const order: CreateRazorpayOrderResponse = {
    payment_order_id: paymentOrderId,
    razorpay_order_id: status.gatewayOrderId,
    amount: status.amount,
    amount_paise: Math.round(status.amount * 100),
    currency: status.currency || "INR",
    key_id: paymentConfig.razorpayKeyId,
    status: status.status,
  };

  if (!order.key_id) {
    throw new Error("RAZORPAY_KEY_MISSING");
  }

  return completeRazorpayCheckout(order);
}

/** Start top-up flow — Razorpay native checkout or legacy URL gateway. */
export async function startTopupPayment(
  order: TopupOrderResponse
): Promise<{ openedCheckout: boolean; order: TopupOrderResponse }> {
  if (!checkGatewayConfigured()) {
    return { openedCheckout: false, order };
  }

  if (isRazorpayGateway()) {
    return { openedCheckout: false, order };
  }

  const status = await walletService.getPaymentOrderStatus(order.paymentOrderId);
  if (status?.checkoutUrl) {
    await openGatewayCheckout(status.checkoutUrl);
    return { openedCheckout: true, order };
  }

  return { openedCheckout: false, order };
}

export async function openGatewayCheckout(checkoutUrl: string): Promise<void> {
  if (!checkoutUrl) return;
  const canOpen = await Linking.canOpenURL(checkoutUrl);
  if (!canOpen) throw new Error("CHECKOUT_URL_INVALID");
  await Linking.openURL(checkoutUrl);
}

export interface SessionPaymentSummary {
  paymentId: string;
  sessionId: string;
  amount: number;
  gstAmount: number;
  totalAmount: number;
  status: string;
  walletBalance: number;
  amountDue: number;
}

export async function getSessionPayment(sessionId: string, userId?: string): Promise<SessionPaymentSummary | null> {
  const uid = userId ?? requireUserId();
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
  return {
    paymentId: row.payment_id as string,
    sessionId: row.session_id as string,
    amount: Number(row.amount),
    gstAmount: Number(row.gst_amount),
    totalAmount: Number(row.total_amount),
    status: row.status as string,
    walletBalance: Number(row.wallet_balance),
    amountDue: Number(row.amount_due),
  };
}

async function getSessionPaymentFallback(sessionId: string, userId: string): Promise<SessionPaymentSummary | null> {
  const [paymentRes, wallet] = await Promise.all([
    requireSupabase()
      .from("EV_Payments")
      .select("id, session_id, amount, gst_amount, total_amount, status")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    walletService.getWalletSummary(userId),
  ]);

  if (paymentRes.error) throw paymentRes.error;
  if (!paymentRes.data) return null;

  const row = paymentRes.data as Record<string, unknown>;
  const status = String(row.status);
  const totalAmount = Number(row.total_amount);
  const paid = status === "success" || status === "paid";

  return {
    paymentId: row.id as string,
    sessionId: row.session_id as string,
    amount: Number(row.amount),
    gstAmount: Number(row.gst_amount),
    totalAmount,
    status,
    walletBalance: wallet?.usableBalance ?? 0,
    amountDue: paid ? 0 : totalAmount,
  };
}

export async function paySessionFromWallet(sessionId: string, userId?: string): Promise<SessionPaymentSummary> {
  const uid = userId ?? requireUserId();
  const { error } = await requireSupabase().rpc("ev_pay_session_from_wallet", {
    p_user_id: uid,
    p_session_id: sessionId,
  });
  if (error) throw error;
  const updated = await getSessionPayment(sessionId, uid);
  if (!updated) throw new Error("PAYMENT_NOT_FOUND");
  return updated;
}

export async function refreshTopupOrderStatus(paymentOrderId: string): Promise<PaymentOrder | null> {
  const row = await walletService.getPaymentOrderStatus(paymentOrderId);
  if (!row) return null;
  return {
    id: row.paymentOrderId,
    userId: requireUserId(),
    amount: row.amount,
    currency: row.currency,
    gatewayName: row.gatewayName,
    gatewayOrderId: row.gatewayOrderId,
    gatewayPaymentId: row.gatewayPaymentId,
    checkoutUrl: row.checkoutUrl,
    status: row.status,
    walletCredited: row.walletCredited,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type { CreateRazorpayOrderResponse };
