import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4040),
  ocppWsPort: Number(process.env.OCPP_WS_PORT ?? 4041),
  ocppWsPath: process.env.OCPP_WS_PATH ?? "/ocpp",
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
};
