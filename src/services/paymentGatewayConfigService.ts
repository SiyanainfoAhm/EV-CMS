/**
 * Web admin payment gateway config — reads/writes EV_SystemConfig via RPCs.
 * Secrets stay in edge function env; this only exposes safe public fields.
 */

import { requireSupabase } from "@/utils/supabaseClient";
import {
  parsePaymentGatewayConfig,
  resolveActiveGateway,
  type PaymentGatewayConfig,
  type PaymentGatewayName,
} from "@/types/paymentGateway";

export type { PaymentGatewayConfig, PaymentGatewayName };

export async function getPaymentGatewayConfig(): Promise<PaymentGatewayConfig> {
  const { data, error } = await requireSupabase().rpc("ev_get_payment_gateway_public");
  if (error) {
    console.warn("[payment-config] rpc failed, defaulting to Razorpay testing", error.message);
    return parsePaymentGatewayConfig({ testing_mode: true });
  }
  const cfg = parsePaymentGatewayConfig(data);
  console.log("[payment-config] testing_mode", cfg.testing_mode);
  console.log("[payment-config] active_gateway", cfg.active_gateway);
  return cfg;
}

export async function isTestingMode(): Promise<boolean> {
  const cfg = await getPaymentGatewayConfig();
  return cfg.testing_mode;
}

export async function getActivePaymentGateway(): Promise<PaymentGatewayName> {
  const cfg = await getPaymentGatewayConfig();
  return resolveActiveGateway(cfg);
}

/** SuperAdmin only — SiteAdmin must not call this. */
export async function setPaymentGatewayTestingMode(
  adminUserId: string,
  testingMode: boolean
): Promise<PaymentGatewayConfig> {
  const { data, error } = await requireSupabase().rpc("ev_set_payment_gateway_testing_mode", {
    p_admin_user_id: adminUserId,
    p_testing_mode: testingMode,
  });
  if (error) throw new Error(error.message);
  const cfg = parsePaymentGatewayConfig(data);
  console.log("[payment-config] testing_mode", cfg.testing_mode);
  console.log("[payment-config] active_gateway", cfg.active_gateway);
  return cfg;
}
