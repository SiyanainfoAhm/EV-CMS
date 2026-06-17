import { Linking } from "react-native";
import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import * as walletService from "./walletService";
import type { Payment, PaymentOrder, TopupOrderResponse } from "../types";

const GATEWAY_ENABLED = process.env.EXPO_PUBLIC_PAYMENT_GATEWAY_ENABLED === "true";
const GATEWAY_NAME = process.env.EXPO_PUBLIC_PAYMENT_GATEWAY_NAME ?? "dfccil_gateway";
const PAYMENT_MOCK_ENABLED = process.env.EXPO_PUBLIC_ENABLE_PAYMENT_MOCK === "true";

export function checkGatewayConfigured(): boolean {
  return GATEWAY_ENABLED;
}

export function isPaymentMockEnabled(): boolean {
  return PAYMENT_MOCK_ENABLED;
}

export function getGatewayPendingMessage(): string {
  return "Payment gateway API will be integrated once DFCCIL provides gateway details.";
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

/** Create a top-up payment order (does not credit wallet). */
export async function createTopupPaymentOrder(
  amount: number,
  paymentMethod?: string
): Promise<TopupOrderResponse> {
  const gatewayName = checkGatewayConfigured() ? GATEWAY_NAME : "dfccil_gateway_pending";
  const result = await walletService.createTopupOrder(amount, gatewayName);
  return {
    paymentOrderId: result.paymentOrderId,
    amount: result.amount,
    status: result.status,
    message: result.message,
  };
}

/** Start top-up flow — opens gateway checkout when configured, otherwise returns pending order. */
export async function startTopupPayment(
  order: TopupOrderResponse
): Promise<{ openedCheckout: boolean; order: TopupOrderResponse }> {
  if (!checkGatewayConfigured()) {
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

export async function refreshTopupOrderStatus(paymentOrderId: string): Promise<PaymentOrder | null> {
  const row = await walletService.getPaymentOrderStatus(paymentOrderId);
  if (!row) return null;
  return {
    id: row.paymentOrderId,
    userId: requireUserId(),
    amount: row.amount,
    currency: row.currency,
    gatewayName: row.gatewayName,
    checkoutUrl: row.checkoutUrl,
    status: row.status,
    walletCredited: row.walletCredited,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
