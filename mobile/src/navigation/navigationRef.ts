import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "./AppNavigator";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateFromNotificationData(data: Record<string, unknown> | undefined): void {
  if (!navigationRef.isReady() || !data) return;

  const type = String(data.type ?? data.notification_type ?? "general");
  const referenceId = data.reference_id ?? data.referenceId ?? data.session_id ?? data.sessionId;
  const refStr = referenceId ? String(referenceId) : "";

  switch (type) {
    case "charging_started":
    case "charging_stopped":
    case "session":
      if (refStr) navigationRef.navigate("SessionSummary", { sessionId: refStr });
      else navigationRef.navigate("LiveSession");
      break;
    case "payment_success":
    case "payment_failed":
    case "success":
      navigationRef.navigate("Wallet");
      break;
    case "wallet_low_balance":
      navigationRef.navigate("Topup");
      break;
    case "support_ticket_updated":
      if (refStr) navigationRef.navigate("SupportTicketDetail", { id: refStr });
      else navigationRef.navigate("SupportTickets");
      break;
    case "charger_fault":
    case "charger_offline":
    case "alert":
    case "warning":
      if (refStr) navigationRef.navigate("ChargerDetail", { id: refStr });
      else navigationRef.navigate("Chargers");
      break;
    default:
      navigationRef.navigate("Notifications");
      break;
  }
}
