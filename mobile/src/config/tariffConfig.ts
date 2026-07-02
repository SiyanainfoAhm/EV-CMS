/**
 * Tariff configuration for the mobile app.
 * Rates and GST are stored in Supabase EV_Tariffs — update them from the admin dashboard.
 */
export const tariffConfig = {
  /** Display label for the current rollout region (informational only). */
  defaultRegion: "Noida, Uttar Pradesh",
  /** Table / RPC used for billing — not a hardcoded price. */
  tariffSource: "EV_Tariffs",
  billingRpc: "ev_calculate_session_bill",
} as const;
