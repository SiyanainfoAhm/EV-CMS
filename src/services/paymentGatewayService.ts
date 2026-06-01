/**
 * Payment gateway placeholders.
 * Production implementation must credit payments directly to the DFCCIL account.
 */

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

export async function initiatePayment(params: InitiatePaymentParams): Promise<{ paymentId: string; redirectUrl?: string }> {
  // TODO: POST ${paymentUrl}/payments/initiate — funds routed to DFCCIL account
  console.warn("[paymentGatewayService] initiatePayment placeholder", paymentUrl, params);
  return { paymentId: `pay_${Date.now()}` };
}

export async function verifyPayment(paymentId: string): Promise<PaymentVerificationResult> {
  // TODO: GET ${paymentUrl}/payments/${paymentId}/verify
  console.warn("[paymentGatewayService] verifyPayment placeholder", paymentId);
  return { verified: true, status: "success", gatewayTxnId: "SBI-MOCK-001" };
}

export async function reconcilePayment(paymentId: string): Promise<{ matched: boolean }> {
  // TODO: POST ${paymentUrl}/payments/${paymentId}/reconcile
  console.warn("[paymentGatewayService] reconcilePayment placeholder", paymentId);
  return { matched: true };
}

export async function generateReceipt(paymentId: string): Promise<{ receiptNumber: string; pdfUrl?: string }> {
  // TODO: POST ${paymentUrl}/receipts — persist to "EV_Receipts"
  console.warn("[paymentGatewayService] generateReceipt placeholder", paymentId);
  return { receiptNumber: `RCP-${paymentId}` };
}
