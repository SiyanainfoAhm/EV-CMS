/** Shared payment gateway helpers for Deno edge functions (no secrets logged). */

export type PaymentGatewayName = "razorpay" | "hdfc";

export type PaymentGatewayConfig = {
  testing_mode: boolean;
  test_gateway: PaymentGatewayName;
  production_gateway: PaymentGatewayName;
  active_gateway: PaymentGatewayName;
  active_currency: string;
  gst_enabled: boolean;
};

type SupabaseLike = {
  // Keep loose because Supabase Edge Function generated types may not know custom RPC names.
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};

function normalizeGateway(value: unknown, fallback: PaymentGatewayName): PaymentGatewayName {
  const normalized = String(value ?? fallback).toLowerCase().trim();
  return normalized === "hdfc" ? "hdfc" : "razorpay";
}

export function parsePaymentGatewayConfig(raw: unknown): PaymentGatewayConfig {
  let obj: Record<string, unknown> = {};

  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }

  const testingMode = obj.testing_mode !== false;

  const testGateway = normalizeGateway(obj.test_gateway, "razorpay");
  const productionGateway = normalizeGateway(obj.production_gateway, "hdfc");

  return {
    testing_mode: testingMode,
    test_gateway: testGateway,
    production_gateway: productionGateway,
    active_gateway: testingMode ? testGateway : productionGateway,
    active_currency: String(obj.active_currency ?? "INR"),
    gst_enabled: obj.gst_enabled !== false,
  };
}

export async function loadPaymentGatewayConfig(
  // deno-lint-ignore no-explicit-any
  supabase: any
): Promise<PaymentGatewayConfig> {
  const { data, error } = await (supabase as SupabaseLike).rpc(
    "ev_get_payment_gateway_public"
  );

  if (error) {
    console.warn(
      "[payment-config] rpc failed, default Razorpay testing",
      error.message
    );

    return parsePaymentGatewayConfig({
      testing_mode: true,
      test_gateway: "razorpay",
      production_gateway: "hdfc",
      active_currency: "INR",
      gst_enabled: true,
    });
  }

  const cfg = parsePaymentGatewayConfig(data);

  console.log("[payment-config] testing_mode", cfg.testing_mode);
  console.log("[payment-config] active_gateway", cfg.active_gateway);

  return cfg;
}

export function isHdfcEnvConfigured(): boolean {
  const merchant = Deno.env.get("HDFC_MERCHANT_ID") ?? "";
  const access =
    Deno.env.get("HDFC_ACCESS_CODE") ??
    Deno.env.get("HDFC_WORKING_KEY") ??
    "";
  const url = Deno.env.get("HDFC_PAYMENT_URL") ?? "";

  return Boolean(merchant && access && url);
}