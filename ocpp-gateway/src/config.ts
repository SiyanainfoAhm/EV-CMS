import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4040),
  ocppWsPath: process.env.OCPP_WS_PATH ?? "/ocpp",
  ocppCallTimeoutMs: Number(process.env.OCPP_CALL_TIMEOUT_MS ?? 30000),
  heartbeatIntervalSec: Number(process.env.OCPP_HEARTBEAT_INTERVAL_SEC ?? 300),
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
};
