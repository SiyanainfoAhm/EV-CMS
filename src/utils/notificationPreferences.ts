import type { NotificationPreferences } from "@/types/profile";

export type NotificationCategory = keyof NotificationPreferences | "general";

export function resolveNotificationCategory(input: {
  title: string;
  message: string;
  type: string;
}): NotificationCategory {
  const text = `${input.title} ${input.message}`.toLowerCase();

  if (text.includes("offline") || text.includes("heartbeat")) return "chargerOffline";
  if (text.includes("back online") || text.includes("reconnected")) return "chargerOffline";
  if (text.includes("fault")) return "chargerFaulted";
  if (
    text.includes("session") &&
    (text.includes("start") || text.includes("begun") || text.includes("started") || text.includes("charging started"))
  ) {
    return "sessionStarted";
  }
  if (
    text.includes("session") &&
    (text.includes("stop") || text.includes("end") || text.includes("completed") || text.includes("closed"))
  ) {
    return "sessionStopped";
  }
  if (text.includes("payment") || text.includes("reconciled") || text.includes("transaction")) {
    return "paymentReceived";
  }
  if (text.includes("firmware")) return "firmwareAvailable";
  if (text.includes("weekly") || text.includes("summary report")) return "weeklyReport";
  if (text.includes("daily digest") || text.includes("daily summary")) return "emailDigest";

  if (input.type === "warning") return "chargerOffline";
  if (input.type === "alert") return "chargerFaulted";
  if (input.type === "session") return "sessionStarted";
  if (input.type === "success" && text.includes("payment")) return "paymentReceived";

  return "general";
}

export function isNotificationEnabled(
  input: { title: string; message: string; type: string },
  prefs: NotificationPreferences
): boolean {
  const category = resolveNotificationCategory(input);
  if (category === "general") return true;
  return prefs[category];
}

export function preferenceLabel(key: keyof NotificationPreferences): string {
  const labels: Record<keyof NotificationPreferences, string> = {
    chargerOffline: "Charger offline / back online",
    chargerFaulted: "Charger fault detected",
    sessionStarted: "New session started",
    sessionStopped: "Session stopped",
    paymentReceived: "Payment received",
    firmwareAvailable: "Firmware update sent / failed",
    weeklyReport: "Weekly summary report",
    emailDigest: "Daily email digest",
  };
  return labels[key];
}
