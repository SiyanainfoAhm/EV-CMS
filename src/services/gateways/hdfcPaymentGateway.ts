/**
 * HDFC payment gateway adapter (production).
 * Placeholder until client provides exact HDFC integration (SmartGateway / CCAvenue / etc.).
 * Does not mix with Razorpay files. Never fakes payment success.
 */

import type {
  CreatePaymentOrderInput,
  CreatePaymentOrderResult,
  PaymentGatewayAdapter,
  VerifyPaymentInput,
  VerifyPaymentResult,
} from "@/types/paymentGateway";
import { normalizePaymentFailure } from "@/types/paymentGateway";

const HDFC_NOT_CONFIGURED = "HDFC payment gateway is not configured yet.";

export function isHdfcConfigured(): boolean {
  // Browser must never hold HDFC secrets — only edge/backend env does.
  return false;
}

export async function createHdfcPaymentRequest(
  _input: CreatePaymentOrderInput
): Promise<CreatePaymentOrderResult> {
  console.log("[hdfc] request created — not configured");
  throw new Error(HDFC_NOT_CONFIGURED);
}

export async function generateChecksumOrEncryptedPayload(
  _fields: Record<string, string>
): Promise<string> {
  throw new Error(HDFC_NOT_CONFIGURED);
}

export async function verifyHdfcResponse(
  _payload: Record<string, unknown>
): Promise<VerifyPaymentResult> {
  console.log("[hdfc] response verified — not configured");
  throw new Error(HDFC_NOT_CONFIGURED);
}

export async function handleHdfcReturnUrl(
  _query: Record<string, string>
): Promise<VerifyPaymentResult> {
  throw new Error(HDFC_NOT_CONFIGURED);
}

export function normalizeHdfcPaymentStatus(
  rawStatus: string
): "created" | "paid" | "failed" | "cancelled" {
  const s = rawStatus.toLowerCase();
  if (s === "success" || s === "paid" || s === "captured") return "paid";
  if (s === "cancelled" || s === "aborted") return "cancelled";
  if (s === "created" || s === "pending" || s === "initiated") return "created";
  return "failed";
}

export const hdfcPaymentGateway: PaymentGatewayAdapter = {
  gatewayName: "hdfc",
  async createOrder(input) {
    return createHdfcPaymentRequest(input);
  },
  async verifyPayment(input) {
    if (input.return_payload) {
      return verifyHdfcResponse(input.return_payload);
    }
    return normalizePaymentFailure("hdfc", input.gateway_order_id, "failed");
  },
};
