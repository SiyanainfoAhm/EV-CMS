import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import * as rfidService from "./rfidService";
import * as sessionService from "./sessionService";
import { assertChargerOnlineForMobile } from "./chargerService";
import type { ChargingSession, PrepaidPaymentCalculation } from "../types";

async function assertUserCanCharge(userId: string): Promise<void> {
  const { data, error } = await requireSupabase().rpc("get_ev_user_profile", {
    p_user_id: userId,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || (row as { status: string }).status !== "active") {
    throw new Error("USER_INACTIVE");
  }
}

async function assertRfidOrMobileAuth(userId: string): Promise<void> {
  const cards = await rfidService.getUserRfidCards(userId);
  const hasActive = cards.some((c) => c.status === "active");
  if (!hasActive) {
    // Mobile authorization path — allow demo users without RFID
    return;
  }
}

export type StartChargingPrepaidOptions = {
  prepaidAmount?: number;
  targetKwh?: number;
  tariffId?: string;
  prepaidMode?: "amount" | "time";
  prepaidValue?: number;
  prepaidTotalInr?: number;
  prepaidEnergyCapKwh?: number;
  prepaidPlanId?: string;
  prepaidExpiresAt?: string;
  settlementStatus?: string;
  paymentMode?: string;
  paymentStatus?: string;
  prepaidDurationMinutes?: number;
  amountDue?: number;
};

export async function startCharging(
  chargerId: string,
  connectorId: number,
  userId?: string,
  options?: StartChargingPrepaidOptions
): Promise<ChargingSession> {
  const uid = userId ?? requireUserId();
  await assertUserCanCharge(uid);
  await assertRfidOrMobileAuth(uid);
  await assertChargerOnlineForMobile(chargerId);
  const session = await sessionService.startSession(chargerId, connectorId, uid);

  const hasPrepaid =
    (options?.prepaidTotalInr != null && options.prepaidTotalInr > 0) ||
    (options?.prepaidAmount != null && options.prepaidAmount > 0);

  if (hasPrepaid) {
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      settlement_status: options?.settlementStatus ?? "active",
      payment_mode: options?.paymentMode ?? "prepaid",
      payment_status: options?.paymentStatus ?? "pending",
      amount_due: options?.amountDue ?? 0,
      prepaid_type: options?.prepaidMode ?? null,
    };

    if (options?.prepaidAmount != null) update.prepaid_amount = options.prepaidAmount;
    if (options?.targetKwh != null && options.targetKwh > 0) update.target_kwh = options.targetKwh;
    if (options?.tariffId) update.tariff_id = options.tariffId;
    if (options?.prepaidMode) update.prepaid_mode = options.prepaidMode;
    if (options?.prepaidValue != null) update.prepaid_value = options.prepaidValue;
    if (options?.prepaidTotalInr != null) update.prepaid_total_inr = options.prepaidTotalInr;
    if (options?.prepaidEnergyCapKwh != null) {
      update.prepaid_energy_cap_kwh = options.prepaidEnergyCapKwh;
    }
    if (options?.prepaidPlanId) update.prepaid_plan_id = options.prepaidPlanId;
    if (options?.prepaidExpiresAt) update.prepaid_expires_at = options.prepaidExpiresAt;
    if (options?.prepaidDurationMinutes != null) {
      update.prepaid_duration_minutes = options.prepaidDurationMinutes;
    }

    const { error } = await requireSupabase()
      .from("EV_ChargingSessions")
      .update(update)
      .eq("id", session.id)
      .eq("user_id", uid);

    if (
      error &&
      !/prepaid_amount|prepaid_|target_kwh|settlement_status|payment_mode|payment_status|amount_due|column/i.test(
        error.message
      )
    ) {
      console.warn("Could not save prepaid session fields:", error.message);
    }
  }

  return session;
}

export async function markSessionPrepaidPaid(
  sessionId: string,
  paymentId: string,
  userId?: string
): Promise<void> {
  const uid = userId ?? requireUserId();
  const { error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .update({
      payment_mode: "prepaid",
      payment_status: "paid",
      payment_id: paymentId,
      prepaid_payment_id: paymentId,
      amount_due: 0,
      settlement_status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", uid);

  if (error && !/payment_mode|payment_status|amount_due|payment_id|column/i.test(error.message)) {
    console.warn("Could not mark session prepaid paid:", error.message);
  }
}

export async function attachPrepaidPaymentRecord(
  sessionId: string,
  calc: PrepaidPaymentCalculation,
  userId?: string
): Promise<string> {
  const uid = userId ?? requireUserId();

  const { data: existing } = await requireSupabase()
    .from("EV_Payments")
    .select("id, status")
    .eq("session_id", sessionId)
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && (existing as { status: string }).status === "pending") {
    const paymentId = (existing as { id: string }).id;
    const { error } = await requireSupabase()
      .from("EV_Payments")
      .update({
        amount: calc.baseAmount,
        gst_amount: calc.gstAmount,
        total_amount: calc.totalAmount,
        payment_kind: "prepaid",
        gateway: "razorpay",
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId);
    if (error) throw new Error(error.message || "Unable to create payment order");
    return paymentId;
  }

  const { data, error } = await requireSupabase()
    .from("EV_Payments")
    .insert({
      session_id: sessionId,
      user_id: uid,
      amount: calc.baseAmount,
      gst_amount: calc.gstAmount,
      total_amount: calc.totalAmount,
      status: "pending",
      gateway: "razorpay",
      reconciliation_status: "unmatched",
      payment_kind: "prepaid",
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message || "Unable to create payment order");
  }

  const paymentId = (data as { id: string }).id;

  await requireSupabase()
    .from("EV_ChargingSessions")
    .update({
      prepaid_payment_id: paymentId,
      prepaid_total_inr: calc.totalAmount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", uid);

  return paymentId;
}

export function buildPrepaidSessionOptions(
  input: {
    mode: "amount" | "time";
    planId?: string | null;
    prepaidValue: number;
    calculation: PrepaidPaymentCalculation;
    tariffId?: string;
  }
): StartChargingPrepaidOptions {
  const calc = input.calculation;
  const expiresAt =
    input.mode === "time" && calc.durationMinutes
      ? new Date(Date.now() + calc.durationMinutes * 60_000).toISOString()
      : undefined;

  const energyCap =
    input.mode === "time"
      ? calc.estimatedKwh ?? undefined
      : calc.ratePerKwh && calc.ratePerKwh > 0
        ? Math.round((calc.baseAmount / calc.ratePerKwh) * 1000) / 1000
        : undefined;

  return {
    prepaidAmount: calc.totalAmount,
    targetKwh: calc.estimatedKwh ?? energyCap,
    tariffId: input.tariffId,
    prepaidMode: input.mode,
    prepaidValue: input.prepaidValue,
    prepaidTotalInr: calc.totalAmount,
    prepaidEnergyCapKwh: energyCap,
    prepaidPlanId: input.planId ?? undefined,
    prepaidExpiresAt: expiresAt,
    settlementStatus: "active",
    paymentMode: "prepaid",
    paymentStatus: "pending",
    prepaidDurationMinutes: input.mode === "time" ? Number(input.prepaidValue) : undefined,
    amountDue: 0,
  };
}

export async function stopCharging(
  sessionId: string,
  userId?: string
): Promise<ChargingSession | null> {
  const uid = userId ?? requireUserId();
  await sessionService.stopSession(sessionId, uid);
  return sessionService.getSessionById(sessionId, uid);
}

export async function getActiveSession(userId?: string): Promise<ChargingSession | null> {
  return sessionService.getActiveSession(userId);
}

export function subscribeActiveSession(onUpdate: () => void): () => void {
  const channel = requireSupabase()
    .channel("mobile-active-session")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "EV_ChargingSessions" },
      () => onUpdate()
    )
    .subscribe();

  return () => {
    requireSupabase().removeChannel(channel);
  };
}
