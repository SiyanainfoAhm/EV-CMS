/** Shared payment gateway types — DB decides active gateway; secrets stay server-side. */

export type PaymentGatewayName = "razorpay" | "hdfc";

export type NormalizedPaymentStatus = "created" | "paid" | "failed" | "cancelled";

export interface PaymentGatewayConfig {
  testing_mode: boolean;
  test_gateway: PaymentGatewayName;
  production_gateway: PaymentGatewayName;
  active_gateway: PaymentGatewayName;
  active_currency: string;
  gst_enabled: boolean;
}

export interface CreatePaymentOrderInput {
  userId: string;
  sessionId?: string;
  paymentId?: string;
  chargerId?: string;
  chargePointId?: string;
  connectorId?: number;
  paymentMode?: "prepaid";
  prepaidType?: "amount" | "time";
  baseAmount?: number;
  sessionFee?: number;
  gstAmount?: number;
  totalAmount: number;
  currency?: string;
  tariffId?: string;
  ratePerKwh?: number;
  estimatedKwh?: number;
  prepaidDurationMinutes?: number;
  estimatedKwhLimit?: number;
}

export interface CreatePaymentOrderResult {
  gateway: PaymentGatewayName;
  testing_mode: boolean;
  payment_order_id: string;
  gateway_order_id: string;
  amount: number;
  amount_paise?: number;
  currency: string;
  status: NormalizedPaymentStatus;
  /** Razorpay publishable key — never secret */
  key_id?: string;
  /** HDFC hosted checkout URL / form fields when configured */
  checkout_url?: string;
  checkout_payload?: Record<string, string>;
  raw_response?: unknown;
}

export interface VerifyPaymentInput {
  gateway: PaymentGatewayName;
  payment_order_id: string;
  gateway_order_id: string;
  gateway_payment_id?: string;
  gateway_signature?: string;
  /** HDFC return / redirect payload */
  return_payload?: Record<string, unknown>;
}

export interface VerifyPaymentResult {
  gateway: PaymentGatewayName;
  gateway_order_id: string;
  gateway_payment_id?: string;
  status: NormalizedPaymentStatus;
  amount?: number;
  currency?: string;
  payment_id?: string;
  session_id?: string;
  receipt_number?: string | null;
  raw_response?: unknown;
}

export interface PaymentGatewayAdapter {
  gatewayName: PaymentGatewayName;
  createOrder(input: CreatePaymentOrderInput): Promise<CreatePaymentOrderResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
}

export function resolveActiveGateway(config: PaymentGatewayConfig): PaymentGatewayName {
  return config.testing_mode ? config.test_gateway : config.production_gateway;
}

export function parsePaymentGatewayConfig(raw: unknown): PaymentGatewayConfig {
  const obj =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw) as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      : raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : {};

  const testing_mode = obj.testing_mode !== false;
  const test_gateway = (String(obj.test_gateway ?? "razorpay").toLowerCase() === "hdfc"
    ? "hdfc"
    : "razorpay") as PaymentGatewayName;
  const production_gateway = (String(obj.production_gateway ?? "hdfc").toLowerCase() === "razorpay"
    ? "razorpay"
    : "hdfc") as PaymentGatewayName;

  return {
    testing_mode,
    test_gateway,
    production_gateway,
    active_gateway: testing_mode ? test_gateway : production_gateway,
    active_currency: String(obj.active_currency ?? "INR"),
    gst_enabled: obj.gst_enabled !== false,
  };
}

export function normalizePaymentSuccess(
  gateway: PaymentGatewayName,
  input: {
    gateway_order_id: string;
    gateway_payment_id?: string;
    amount?: number;
    currency?: string;
    payment_id?: string;
    session_id?: string;
    receipt_number?: string | null;
    raw_response?: unknown;
  }
): VerifyPaymentResult {
  return {
    gateway,
    gateway_order_id: input.gateway_order_id,
    gateway_payment_id: input.gateway_payment_id,
    status: "paid",
    amount: input.amount,
    currency: input.currency ?? "INR",
    payment_id: input.payment_id,
    session_id: input.session_id,
    receipt_number: input.receipt_number ?? null,
    raw_response: input.raw_response,
  };
}

export function normalizePaymentFailure(
  gateway: PaymentGatewayName,
  gateway_order_id: string,
  status: "failed" | "cancelled" = "failed",
  raw_response?: unknown
): VerifyPaymentResult {
  return {
    gateway,
    gateway_order_id,
    status,
    raw_response,
  };
}
