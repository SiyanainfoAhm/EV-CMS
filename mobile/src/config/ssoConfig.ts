export const ssoConfig = {
  enabled: process.env.EXPO_PUBLIC_SSO_ENABLED === "true",
  issuer: "https://app2.dfccil.com",
  clientId: "f51c3d26cd09487eb2350a9742b8af18",
  redirectUri: process.env.EXPO_PUBLIC_SSO_REDIRECT_URI || "in.dfccil.evcms://auth/callback",
  backendUrl: (process.env.EXPO_PUBLIC_SSO_BACKEND_URL || "").replace(/\/$/, ""),
};
