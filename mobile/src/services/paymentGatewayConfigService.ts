/**
 * Mobile-safe payment gateway config (no secrets).
 * Active gateway comes from EV_SystemConfig via RPC — not from .env alone.
 */

import { requireSupabase } from "../utils/supabaseClient";

export type PaymentGatewayName = "razorpay" | "hdfc";

export type PaymentGatewayPublicConfig = {
  testing_mode: boolean;
  test_gateway: PaymentGatewayName;
  production_gateway: PaymentGatewayName;
  active_gateway: PaymentGatewayName;
  active_currency: string;
  gst_enabled: boolean;
};

const DEFAULT_CONFIG: PaymentGatewayPublicConfig = {
  testing_mode: true,
  test_gateway: "razorpay",
  production_gateway: "hdfc",
  active_gateway: "razorpay",
  active_currency: "INR",
  gst_enabled: true,
};

let cached: { at: number; config: PaymentGatewayPublicConfig } | null = null;
const CACHE_MS = 30_000;

function parseConfig(raw: unknown): PaymentGatewayPublicConfig {
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
  const test_gateway: PaymentGatewayName =
    String(obj.test_gateway ?? "razorpay").toLowerCase() === "hdfc" ? "hdfc" : "razorpay";
  const production_gateway: PaymentGatewayName =
    String(obj.production_gateway ?? "hdfc").toLowerCase() === "razorpay" ? "razorpay" : "hdfc";
  const active_gateway =
    (obj.active_gateway as PaymentGatewayName | undefined) ??
    (testing_mode ? test_gateway : production_gateway);

  return {
    testing_mode,
    test_gateway,
    production_gateway,
    active_gateway: active_gateway === "hdfc" ? "hdfc" : "razorpay",
    active_currency: String(obj.active_currency ?? "INR"),
    gst_enabled: obj.gst_enabled !== false,
  };
}

export async function getPaymentGatewayConfig(
  forceRefresh = false
): Promise<PaymentGatewayPublicConfig> {
  if (!forceRefresh && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.config;
  }

  try {
    const { data, error } = await requireSupabase().rpc("ev_get_payment_gateway_public");
    if (error) {
      console.warn("[payment-config] rpc failed, default Razorpay testing", error.message);
      cached = { at: Date.now(), config: DEFAULT_CONFIG };
      return DEFAULT_CONFIG;
    }
    const config = parseConfig(data);
    console.log("[payment-config] testing_mode", config.testing_mode);
    console.log("[payment-config] active_gateway", config.active_gateway);
    cached = { at: Date.now(), config };
    return config;
  } catch (e) {
    console.warn("[payment-config] error", e);
    return DEFAULT_CONFIG;
  }
}

export async function isTestingMode(): Promise<boolean> {
  return (await getPaymentGatewayConfig()).testing_mode;
}

export async function getActivePaymentGateway(): Promise<PaymentGatewayName> {
  return (await getPaymentGatewayConfig()).active_gateway;
}

export function clearPaymentGatewayConfigCache(): void {
  cached = null;
}
