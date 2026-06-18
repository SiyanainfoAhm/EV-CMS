export const paymentConfig = {
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, ""),
  supabaseUrl: (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, ""),
  gatewayEnabled: process.env.EXPO_PUBLIC_PAYMENT_GATEWAY_ENABLED === "true",
  gatewayName: (process.env.EXPO_PUBLIC_PAYMENT_GATEWAY_NAME || "razorpay").toLowerCase(),
  razorpayKeyId: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || "",
  themeColor: process.env.EXPO_PUBLIC_RAZORPAY_THEME_COLOR || "#0B5FFF",
  mockEnabled: process.env.EXPO_PUBLIC_ENABLE_PAYMENT_MOCK === "true",
};

export function isRazorpayGateway(): boolean {
  return paymentConfig.gatewayName === "razorpay";
}

export function isPaymentApiConfigured(): boolean {
  return Boolean(paymentConfig.apiBaseUrl);
}

/** Razorpay publishable key in the mobile app. */
export function isRazorpayClientConfigured(): boolean {
  return paymentConfig.gatewayEnabled && isRazorpayGateway() && Boolean(paymentConfig.razorpayKeyId);
}

/** Backend available via REST API or Supabase Edge Functions. */
export function canUseRazorpayBackend(): boolean {
  return isPaymentApiConfigured() || Boolean(paymentConfig.supabaseUrl);
}

export function isRazorpayPaymentReady(): boolean {
  return isRazorpayClientConfigured() && canUseRazorpayBackend();
}
