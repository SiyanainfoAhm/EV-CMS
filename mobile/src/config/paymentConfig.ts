export const paymentConfig = {
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, ""),
  supabaseUrl: (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, ""),
  gatewayEnabled: process.env.EXPO_PUBLIC_PAYMENT_GATEWAY_ENABLED === "true",
  /** Publishable Razorpay key only — active gateway is decided by EV_SystemConfig. */
  razorpayKeyId: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || "",
  themeColor: process.env.EXPO_PUBLIC_RAZORPAY_THEME_COLOR || "#0B5FFF",
  mockEnabled: process.env.EXPO_PUBLIC_ENABLE_PAYMENT_MOCK === "true",
};

/** @deprecated Prefer getActivePaymentGateway() from paymentGatewayConfigService */
export function isRazorpayGateway(): boolean {
  return true;
}

export function isPaymentApiConfigured(): boolean {
  return Boolean(paymentConfig.apiBaseUrl);
}

/** Razorpay publishable key present in the mobile app. */
export function isRazorpayClientConfigured(): boolean {
  return paymentConfig.gatewayEnabled && Boolean(paymentConfig.razorpayKeyId);
}

/** Backend available via REST API or Supabase Edge Functions. */
export function canUseRazorpayBackend(): boolean {
  return isPaymentApiConfigured() || Boolean(paymentConfig.supabaseUrl);
}

export function isRazorpayPaymentReady(): boolean {
  return isRazorpayClientConfigured() && canUseRazorpayBackend();
}
