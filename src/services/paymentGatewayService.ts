/**
 * Payment gateway — live URL when configured, otherwise UAT mock (writes to Supabase).
 * Production must route funds to the DFCCIL account via the real gateway.
 */

import * as paymentService from "@/services/paymentService";
import { isPaymentMockEnabled, PAYMENT_MOCK_GATEWAY_NAME } from "@/utils/paymentMockMode";

const paymentUrl = import.meta.env.VITE_PAYMENT_GATEWAY_URL || "";

export interface InitiatePaymentParams {
  sessionId: string;
  userId: string;
  amount: number;
  currency?: string;
}

export interface PaymentVerificationResult {
  verified: boolean;
  gatewayTxnId?: string;
  status: "success" | "failed" | "pending";
}

export function isMockGateway(): boolean {
  return isPaymentMockEnabled();
}

export async function initiatePayment(params: InitiatePaymentParams): Promise<{ paymentId: string; redirectUrl?: string }> {
  if (isPaymentMockEnabled()) {
    const paymentId = await paymentService.createPendingPayment({
      sessionId: params.sessionId,
      userId: params.userId,
      amount: params.amount,
      gateway: PAYMENT_MOCK_GATEWAY_NAME,
    });
    return { paymentId };
  }

  if (!paymentUrl) {
    throw new Error("VITE_PAYMENT_GATEWAY_URL is not configured");
  }

  // Live gateway integration point
  const res = await fetch(`${paymentUrl}/payments/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Payment initiation failed (${res.status})`);
  return res.json() as Promise<{ paymentId: string; redirectUrl?: string }>;
}

export async function verifyPayment(paymentId: string): Promise<PaymentVerificationResult> {
  if (isPaymentMockEnabled()) {
    const txnId = `MOCK-${Date.now()}`;
    await paymentService.markPaymentVerified(paymentId, txnId, PAYMENT_MOCK_GATEWAY_NAME);
    return { verified: true, status: "success", gatewayTxnId: txnId };
  }

  if (!paymentUrl) throw new Error("VITE_PAYMENT_GATEWAY_URL is not configured");

  const res = await fetch(`${paymentUrl}/payments/${paymentId}/verify`);
  if (!res.ok) throw new Error(`Payment verification failed (${res.status})`);
  return res.json() as Promise<PaymentVerificationResult>;
}

export async function reconcilePayment(paymentId: string): Promise<{ matched: boolean }> {
  if (isPaymentMockEnabled()) {
    await paymentService.markPaymentReconciled(paymentId);
    return { matched: true };
  }

  if (!paymentUrl) throw new Error("VITE_PAYMENT_GATEWAY_URL is not configured");

  const res = await fetch(`${paymentUrl}/payments/${paymentId}/reconcile`, { method: "POST" });
  if (!res.ok) throw new Error(`Payment reconciliation failed (${res.status})`);
  return res.json() as Promise<{ matched: boolean }>;
}

export async function generateReceipt(paymentId: string): Promise<{ receiptNumber: string; pdfUrl?: string }> {
  if (isPaymentMockEnabled()) {
    return paymentService.createReceiptForPayment(paymentId);
  }

  if (!paymentUrl) throw new Error("VITE_PAYMENT_GATEWAY_URL is not configured");

  const res = await fetch(`${paymentUrl}/receipts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentId }),
  });
  if (!res.ok) throw new Error(`Receipt generation failed (${res.status})`);
  return res.json() as Promise<{ receiptNumber: string; pdfUrl?: string }>;
}
