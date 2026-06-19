/** UAT mock gateway: on when no live URL, or explicitly VITE_PAYMENT_GATEWAY_MOCK=true */
export function isPaymentMockEnabled(): boolean {
  if (import.meta.env.VITE_PAYMENT_GATEWAY_MOCK === "true") return true;
  if (import.meta.env.VITE_PAYMENT_GATEWAY_MOCK === "false") return false;
  return !String(import.meta.env.VITE_PAYMENT_GATEWAY_URL ?? "").trim();
}

export const PAYMENT_MOCK_GATEWAY_NAME = "DFCCIL-Mock";
