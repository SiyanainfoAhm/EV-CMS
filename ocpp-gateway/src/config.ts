import "dotenv/config";

function envFlag(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export const config = {
  port: Number(process.env.PORT ?? 4040),
  ocppWsPath: process.env.OCPP_WS_PATH ?? "/ocpp",
  ocppCallTimeoutMs: Number(process.env.OCPP_CALL_TIMEOUT_MS ?? 30000),
  heartbeatIntervalSec: Number(process.env.OCPP_HEARTBEAT_INTERVAL_SEC ?? 300),
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  /** TEMP ONLY — accept any idTag on Authorize / StartTransaction (set OCPP_BYPASS_RFID_AUTH=true). */
  bypassRfidAuth: envFlag("OCPP_BYPASS_RFID_AUTH"),
};
