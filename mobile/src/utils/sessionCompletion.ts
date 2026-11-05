import { dfccilPaymentsEnabled } from "../config/dfccilPaymentConfig";
import type { ChargingSession } from "../types";
import type { SessionPaymentSummary } from "../services/paymentService";

export type CompletionBannerState = {
  titleKey: string;
  messageKey: string;
  showPayButton: boolean;
  isPrepaidPaid: boolean;
  isOfflineBill: boolean;
};

function lower(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .trim();
}

/** Session used amount/time limits (legacy prepaid columns or offline limits). */
export function isPrepaidSession(session: ChargingSession | null | undefined): boolean {
  if (!session) return false;
  if (session.prepaidMode === "amount" || session.prepaidMode === "time") return true;
  if ((session.prepaidTotalInr ?? 0) > 0) return true;
  return false;
}

export function isOfflinePaymentSession(session: ChargingSession | null | undefined): boolean {
  const mode = lower(session?.paymentMode);
  return mode === "offline" || mode === "postpaid" || mode === "physical" || isPrepaidSession(session);
}

/**
 * Online collection is allowed for completed unpaid bills when DFCCIL mode is enabled.
 */
export function shouldShowPostSessionPayment(
  session?: ChargingSession | null,
  payment?: SessionPaymentSummary | null
): boolean {
  const status = lower(session?.paymentStatus ?? payment?.status);
  return dfccilPaymentsEnabled && Boolean(session && ["completed","stopped","faulted"].includes(lower(session.status))) &&
    !["paid","success","collected","paid_offline"].includes(status);
}

export function getCompletionBannerState(
  session: ChargingSession | null | undefined,
  payment?: SessionPaymentSummary | null
): CompletionBannerState {
  const status = lower(session?.paymentStatus ?? payment?.status);
  const collected = status === "paid" || status === "success" || status === "collected" || status === "paid_offline";

  if (dfccilPaymentsEnabled) {
    return { titleKey: "session.chargingCompletedTitle", messageKey: collected ? "session.paymentCompleted" : "dfccil.billReady",
      showPayButton: shouldShowPostSessionPayment(session,payment), isPrepaidPaid: false, isOfflineBill: isOfflinePaymentSession(session) };
  }
  if (isOfflinePaymentSession(session)) {
    return {
      titleKey: "session.chargingCompletedTitle",
      messageKey: collected ? "session.paymentCompleted" : "session.prepaidAlreadyPaid",
      showPayButton: false,
      isPrepaidPaid: false,
      isOfflineBill: true,
    };
  }

  return {
    titleKey: "session.chargingCompletedTitle",
    messageKey: "session.completedSuccessfully",
    showPayButton: false,
    isPrepaidPaid: false,
    isOfflineBill: true,
  };
}

export function offlineCollectionStatusLabel(
  session: ChargingSession | null | undefined,
  payment?: SessionPaymentSummary | null
): "Unpaid" | "Paid Offline" | "Collected" {
  const status = lower(session?.paymentStatus ?? payment?.status);
  if (status === "collected") return "Collected";
  if (status === "paid" || status === "success" || status === "paid_offline") return "Paid Offline";
  return "Unpaid";
}
