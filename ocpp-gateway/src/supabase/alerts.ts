import { getSupabase, isSupabaseConfigured } from "./client.js";

export async function notifyFirmwareAlert(
  chargePointId: string,
  outcome: "sent" | "failed" | "installed",
  detail: string
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const rpcOutcome =
    outcome === "failed" ? "failed" : outcome === "installed" ? "installed" : "sent";

  try {
    const { error } = await getSupabase().rpc("ev_notify_firmware_alert", {
      p_charge_point_id: chargePointId,
      p_outcome: rpcOutcome,
      p_detail: detail,
    });
    if (error) {
      console.warn("[alerts] firmware notify failed:", error.message);
    }
  } catch (err) {
    console.warn("[alerts] firmware notify error:", err);
  }
}
