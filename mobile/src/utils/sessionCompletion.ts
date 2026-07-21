import type { ChargingSession } from "../types";
import type { SessionPaymentSummary } from "../services/paymentService";

export type CompletionBannerState = {
  titleKey: string;
  messageKey: string;
  showPayButton: boolean;
  isPrepaidPaid: boolean;
};

function lower(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .trim();
}

export function isPrepaidSession(session: ChargingSession | null | undefined): boolean {
  if (!session) return false;
  if (lower(session.paymentMode) === "prepaid") return true;
  if (lower(session.paymentStatus) === "paid" && (session.prepaidMode || session.prepaidTotalInr)) {
    return true;
  }
  if (session.prepaidMode === "amount" || session.prepaidMode === "time") return true;
  if ((session.prepaidTotalInr ?? 0) > 0) return true;
  return false;
}

export function shouldShowPostSessionPayment(
  session: ChargingSession | null | undefined,
  payment?: SessionPaymentSummary | null
): boolean {
  const paymentMode = lower(session?.paymentMode);
  const paymentStatus = lower(session?.paymentStatus ?? payment?.status);
  const amountDue = Number(
    session?.amountDue != null ? session.amountDue : payment?.amountDue ?? 0
  );

  if (paymentMode === "prepaid") return false;
  if (isPrepaidSession(session)) return false;
  if (paymentStatus === "paid" || paymentStatus === "success") return false;
  if (payment && (payment.status === "paid" || payment.status === "success") && Number(payment.amountDue) <= 0) {
    return false;
  }

  return amountDue > 0;
}

export function getCompletionBannerState(
  session: ChargingSession | null | undefined,
  payment?: SessionPaymentSummary | null
): CompletionBannerState {
  if (isPrepaidSession(session) || lower(session?.paymentStatus) === "paid" || lower(payment?.status) === "paid" || lower(payment?.status) === "success") {
    if (isPrepaidSession(session) || lower(session?.paymentMode) === "prepaid") {
      return {
        titleKey: "session.chargingCompletedTitle",
        messageKey: "session.prepaidAlreadyPaid",
        showPayButton: false,
        isPrepaidPaid: true,
      };
    }
    return {
      titleKey: "session.chargingCompletedTitle",
      messageKey: "session.paymentCompleted",
      showPayButton: false,
      isPrepaidPaid: false,
    };
  }

  if (shouldShowPostSessionPayment(session, payment)) {
    return {
      titleKey: "session.chargingCompletedTitle",
      messageKey: "session.paymentPendingHint",
      showPayButton: true,
      isPrepaidPaid: false,
    };
  }

  return {
    titleKey: "session.chargingCompletedTitle",
    messageKey: "session.completedSuccessfully",
    showPayButton: false,
    isPrepaidPaid: false,
  };
}
