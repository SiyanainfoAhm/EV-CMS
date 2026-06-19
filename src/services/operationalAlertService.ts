import type { NotificationPreferences } from "@/types/profile";
import { requireSupabase } from "@/utils/supabaseClient";

export type OperationalAlertCategory = keyof Pick<
  NotificationPreferences,
  | "chargerOffline"
  | "chargerFaulted"
  | "sessionStarted"
  | "sessionStopped"
  | "paymentReceived"
  | "firmwareAvailable"
>;

/** Creates in-app admin notifications for admins who have the category enabled in Settings. */
export async function notifyAdminsOperationalAlert(input: {
  category: OperationalAlertCategory;
  title: string;
  message: string;
  type?: string;
}): Promise<number> {
  const { data, error } = await requireSupabase().rpc("ev_notify_admins_if_enabled", {
    p_category: input.category,
    p_title: input.title,
    p_message: input.message,
    p_type: input.type ?? "info",
  });

  if (error) {
    throw new Error(
      error.message.includes("ev_notify_admins_if_enabled")
        ? "Operational alerts are not installed. Run supabase/operational_alerts.sql on Supabase."
        : error.message
    );
  }

  return Number(data ?? 0);
}

/** Firmware alert via RPC (used when OCPP gateway is unavailable). */
export async function notifyFirmwareAlert(
  chargePointId: string,
  outcome: "sent" | "failed" | "installed",
  detail: string
): Promise<number> {
  const { data, error } = await requireSupabase().rpc("ev_notify_firmware_alert", {
    p_charge_point_id: chargePointId,
    p_outcome: outcome,
    p_detail: detail,
  });

  if (error) {
    throw new Error(
      error.message.includes("ev_notify_firmware_alert")
        ? "Firmware alerts are not installed. Run supabase/phase2_operations_alerts.sql on Supabase."
        : error.message
    );
  }

  return Number(data ?? 0);
}
