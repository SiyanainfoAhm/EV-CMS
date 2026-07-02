import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "./AppNavigator";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export interface NotificationNavigationInput {
  type?: string;
  notification_type?: string;
  reference_type?: string;
  referenceType?: string;
  reference_id?: string;
  referenceId?: string;
  session_id?: string;
  sessionId?: string;
  title?: string;
  data?: Record<string, unknown>;
}

function pickReferenceId(input: NotificationNavigationInput): string {
  const fromData = input.data ?? {};
  const raw =
    input.reference_id ??
    input.referenceId ??
    input.session_id ??
    input.sessionId ??
    fromData.reference_id ??
    fromData.referenceId ??
    fromData.session_id ??
    fromData.sessionId;
  return raw ? String(raw) : "";
}

/** Map legacy/ambiguous DB types to a canonical route key. */
export function resolveNotificationRouteKey(input: NotificationNavigationInput): string {
  const data = input.data ?? {};
  const title = String(input.title ?? data.title ?? "").toLowerCase();
  const refType = String(
    input.reference_type ?? input.referenceType ?? data.reference_type ?? data.referenceType ?? ""
  ).toLowerCase();

  let type = String(input.type ?? input.notification_type ?? data.type ?? data.notification_type ?? "general")
    .toLowerCase()
    .trim();

  if (refType === "charging_session" || refType === "session") {
    if (
      type === "charging_stopped" ||
      title.includes("completed") ||
      title.includes("finished") ||
      title.includes("payment due")
    ) {
      return "charging_stopped";
    }
    if (
      type === "charging_started" ||
      type === "session" ||
      title.includes("started") ||
      title.includes("begun") ||
      title.includes("in progress")
    ) {
      return "charging_started";
    }
  }

  if (type === "success") {
    if (title.includes("charging started") || title.includes("session has begun") || title.includes("begun")) {
      return "charging_started";
    }
    if (title.includes("charging completed") || title.includes("session finished") || title.includes("total ₹")) {
      return "charging_stopped";
    }
    if (title.includes("payment") || title.includes("reconciled") || title.includes("transaction")) {
      return "payment_success";
    }
    return "general";
  }

  if (type === "session") return "charging_started";

  if (type === "info") {
    if (title.includes("live session") || title.includes("in progress") || title.includes("active session")) {
      return "charging_started";
    }
    if (title.includes("completed") || title.includes("ended")) {
      return "charging_stopped";
    }
    return "general";
  }

  if (type === "alert") return "charger_fault";
  if (type === "warning") return "charger_offline";

  return type || "general";
}

export function navigateFromNotificationData(data: Record<string, unknown> | undefined): void {
  if (!navigationRef.isReady() || !data) return;

  const input = data as NotificationNavigationInput;
  const routeKey = resolveNotificationRouteKey(input);
  const refStr = pickReferenceId(input);

  switch (routeKey) {
    case "charging_started":
      navigationRef.navigate("LiveSession");
      break;
    case "charging_stopped":
    case "payment_pending":
    case "session_payment_due":
      if (refStr) {
        navigationRef.navigate("SessionSummary", { sessionId: refStr, focusPayment: true });
      } else {
        navigationRef.navigate("SessionHistory");
      }
      break;
    case "payment_success":
      navigationRef.navigate("PaymentHistory");
      break;
    case "payment_failed":
      if (refStr) {
        navigationRef.navigate("SessionSummary", { sessionId: refStr, focusPayment: true });
      } else {
        navigationRef.navigate("PaymentHistory");
      }
      break;
    case "wallet_low_balance":
      navigationRef.navigate("PaymentHistory");
      break;
    case "support_ticket_updated":
      if (refStr) navigationRef.navigate("SupportTicketDetail", { id: refStr });
      else navigationRef.navigate("SupportTickets");
      break;
    case "charger_fault":
    case "charger_offline":
      if (refStr) navigationRef.navigate("ChargerDetail", { id: refStr });
      else navigationRef.navigate("Chargers");
      break;
    default:
      navigationRef.navigate("Notifications");
      break;
  }
}
