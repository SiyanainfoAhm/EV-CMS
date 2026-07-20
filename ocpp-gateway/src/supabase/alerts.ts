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

/** Prepaid paid but RemoteStart failed — admin notification via generic admin notify if available. */
export async function notifyPrepaidStartFailed(
  chargePointId: string,
  detail: string
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await getSupabase().rpc("ev_notify_admins_if_enabled", {
      p_pref_key: "paymentReceived",
      p_title: "Prepaid start failed",
      p_message: `${chargePointId}: ${detail}`,
      p_type: "alert",
    });
    if (error) {
      // Fallback: log only — RPC may not exist on all envs
      console.warn("[alerts] prepaid start-failed notify:", error.message);
    }
  } catch (err) {
    console.warn("[alerts] prepaid start-failed error:", err);
  }
}
