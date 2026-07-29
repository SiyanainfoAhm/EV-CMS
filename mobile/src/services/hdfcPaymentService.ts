/**
 * HDFC mobile checkout adapter (production).
 * Placeholder — show clear error until credentials/flow are configured on backend.
 */

import type { PaymentGatewayName } from "./paymentGatewayConfigService";

export const HDFC_NOT_CONFIGURED = "HDFC payment gateway is not configured yet.";

export type HdfcCheckoutData = {
  gateway: PaymentGatewayName;
  checkout_url?: string;
  checkout_payload?: Record<string, string>;
  payment_order_id: string;
  gateway_order_id: string;
};

/**
 * Open HDFC hosted payment page / WebView when backend returns checkout_url.
 * Until configured, always throws HDFC_NOT_CONFIGURED (no fake success).
 */
export async function openHdfcCheckout(data: HdfcCheckoutData): Promise<never> {
  console.log("[hdfc] request created", {
    payment_order_id: data.payment_order_id,
    has_url: Boolean(data.checkout_url),
  });
  if (!data.checkout_url) {
    throw new Error(HDFC_NOT_CONFIGURED);
  }
  // Future: Linking.openURL(data.checkout_url) or WebView + deep-link return.
  throw new Error(HDFC_NOT_CONFIGURED);
}

export async function handleHdfcReturnDeepLink(_url: string): Promise<never> {
  throw new Error(HDFC_NOT_CONFIGURED);
}
