import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import * as rfidService from "./rfidService";
import * as sessionService from "./sessionService";
import { assertChargerOnlineForMobile } from "./chargerService";
import type { ChargerTariff } from "./tariffService";
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
  if (!userId?.trim()) {
    throw new Error("User session not found. Please login again.");
  }
  // Ensure MOBILE-{userId} authorize tag exists for OCPP (never ADMIN-BYPASS).
  await rfidService.ensureMobileAuthorizeTag(userId);
}

export type StartChargingPrepaidOptions = {
  prepaidAmount?: number;
  targetKwh?: number;
  tariffId?: string;
  ratePerKwhSnapshot?: number;
  sessionFeeSnapshot?: number;
  gstPercentSnapshot?: number;
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

export async function createPendingPrepaidSession(input: {
  chargerId: string;
  connectorId: number;
  userId?: string;
  options: StartChargingPrepaidOptions;
}): Promise<ChargingSession> {
  const uid = input.userId ?? requireUserId();
  await assertUserCanCharge(uid);
  await assertChargerOnlineForMobile(input.chargerId);

  // Placeholder row for Razorpay (payments require session_id) — not an active OCPP charge.
  const txn = Math.floor(Date.now() / 1000) % 2000000000;
  const insert: Record<string, unknown> = {
    transaction_id: txn,
    charger_id: input.chargerId,
    connector_id: input.connectorId,
    user_id: uid,
    start_time: new Date().toISOString(),
    energy_kwh: 0,
    current_power_kw: 0,
    status: "pending_payment",
    authorization_method: "Mobile",
    payment_mode: "prepaid",
    payment_status: "pending",
  };

  const o = input.options;
  if (o.tariffId) insert.tariff_id = o.tariffId;
  if (o.ratePerKwhSnapshot != null) insert.rate_per_kwh_snapshot = o.ratePerKwhSnapshot;
  if (o.sessionFeeSnapshot != null) insert.session_fee_snapshot = o.sessionFeeSnapshot;
  if (o.gstPercentSnapshot != null) insert.gst_percent_snapshot = o.gstPercentSnapshot;
  if (o.prepaidMode) {
    insert.prepaid_mode = o.prepaidMode;
    insert.prepaid_type = o.prepaidMode;
  }
  if (o.prepaidValue != null) insert.prepaid_value = o.prepaidValue;
  if (o.prepaidTotalInr != null) insert.prepaid_total_inr = o.prepaidTotalInr;
  if (o.prepaidAmount != null) insert.prepaid_amount = o.prepaidAmount;
  if (o.prepaidPlanId) insert.prepaid_plan_id = o.prepaidPlanId;
  if (o.prepaidDurationMinutes != null) {
    insert.prepaid_duration_minutes = o.prepaidDurationMinutes;
  }
  // amount_due / settlement_status omitted until columns exist (see fix_session_payment_columns.sql).

  const attempt = async (payload: Record<string, unknown>) =>
    requireSupabase().from("EV_ChargingSessions").insert(payload).select("id").single();

  let { data, error } = await attempt(insert);

  // Strip unknown columns if migration not applied yet, then retry.
  if (error && /column .* does not exist|Could not find/i.test(error.message)) {
    const optional = [
      "amount_due",
      "settlement_status",
      "payment_mode",
      "payment_status",
      "prepaid_type",
      "prepaid_mode",
      "prepaid_value",
      "prepaid_total_inr",
      "prepaid_amount",
      "prepaid_plan_id",
      "prepaid_duration_minutes",
      "authorization_method",
      "tariff_id",
      "rate_per_kwh_snapshot",
      "session_fee_snapshot",
      "gst_percent_snapshot",
    ];
    const stripped = { ...insert };
    for (const key of optional) {
      if (new RegExp(key, "i").test(error.message)) delete stripped[key];
    }
    // If message didn't name the column, drop all optional prepaid fields.
    if (Object.keys(stripped).length === Object.keys(insert).length) {
      for (const key of optional) delete stripped[key];
    }
    ({ data, error } = await attempt(stripped));
  }

  if (error) {
    if (/amount_due/i.test(error.message)) {
      throw new Error(
        "Database missing amount_due column. Run supabase/fix_session_payment_columns.sql in Supabase SQL Editor."
      );
    }
    throw new Error(error.message || "Unable to create prepaid session");
  }

  const session = await sessionService.getSessionById((data as { id: string }).id, uid);
  if (!session) throw new Error("Pending session created but could not be loaded");
  return session;
}

export async function cancelPendingPrepaidSession(
  sessionId: string,
  userId?: string
): Promise<void> {
  const uid = userId ?? requireUserId();
  await requireSupabase()
    .from("EV_ChargingSessions")
    .update({
      status: "cancelled",
      end_time: new Date().toISOString(),
      payment_status: "failed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", uid)
    .eq("status", "pending_payment");
}

/** Write prepaid amount/time limits onto the live OCPP session (gateway auto-stop reads these). */
export async function applyPrepaidLimitsToLiveSession(
  sessionId: string,
  options: StartChargingPrepaidOptions,
  paymentId?: string
): Promise<void> {
  const o = options;
  const expiresAt =
    o.prepaidMode === "time" && o.prepaidDurationMinutes
      ? new Date(Date.now() + o.prepaidDurationMinutes * 60_000).toISOString()
      : o.prepaidExpiresAt;

  const energyCap =
    o.prepaidEnergyCapKwh != null && o.prepaidEnergyCapKwh > 0
      ? o.prepaidEnergyCapKwh
      : undefined;

  const update: Record<string, unknown> = {
    payment_mode: "prepaid",
    payment_status: o.paymentStatus ?? "paid",
    settlement_status: o.settlementStatus ?? "active",
    updated_at: new Date().toISOString(),
  };
  if (paymentId) {
    update.payment_id = paymentId;
    update.prepaid_payment_id = paymentId;
  }
  if (o.prepaidMode) {
    update.prepaid_mode = o.prepaidMode;
    update.prepaid_type = o.prepaidMode;
  }
  if (o.prepaidValue != null) update.prepaid_value = o.prepaidValue;
  if (o.prepaidTotalInr != null) update.prepaid_total_inr = o.prepaidTotalInr;
  if (o.prepaidAmount != null) update.prepaid_amount = o.prepaidAmount;
  if (energyCap != null) {
    update.prepaid_energy_cap_kwh = energyCap;
    update.target_kwh = o.targetKwh ?? energyCap;
  } else if (o.targetKwh != null) {
    update.target_kwh = o.targetKwh;
  }
  if (o.tariffId && !String(o.tariffId).startsWith("fallback-")) {
    update.tariff_id = o.tariffId;
  }
  if (o.ratePerKwhSnapshot != null) update.rate_per_kwh_snapshot = o.ratePerKwhSnapshot;
  if (o.sessionFeeSnapshot != null) update.session_fee_snapshot = o.sessionFeeSnapshot;
  if (o.gstPercentSnapshot != null) update.gst_percent_snapshot = o.gstPercentSnapshot;
  if (o.prepaidPlanId) update.prepaid_plan_id = o.prepaidPlanId;
  if (o.prepaidDurationMinutes != null) {
    update.prepaid_duration_minutes = o.prepaidDurationMinutes;
  }
  if (expiresAt) update.prepaid_expires_at = expiresAt;

  const { error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .update(update)
    .eq("id", sessionId);

  if (error) {
    // Retry without optional columns that older DBs may lack.
    const soft = { ...update };
    delete soft.amount_due;
    delete soft.settlement_status;
    delete soft.authorization_method;
    const { error: err2 } = await requireSupabase()
      .from("EV_ChargingSessions")
      .update(soft)
      .eq("id", sessionId);
    if (err2) {
      console.warn("[prepaid] failed to apply amount/time caps:", err2.message);
      throw new Error(
        "Payment succeeded but prepaid amount/time limits could not be saved. Run supabase/fix_session_payment_columns.sql."
      );
    }
  }

  // Best-effort amount_due = 0 when column exists.
  await requireSupabase()
    .from("EV_ChargingSessions")
    .update({ amount_due: 0, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
}

export async function migratePaymentToLiveSession(input: {
  pendingSessionId: string;
  liveSessionId: string;
  paymentId: string;
  userId?: string;
  options: StartChargingPrepaidOptions;
}): Promise<void> {
  const uid = input.userId ?? requireUserId();

  // Point payment at the real OCPP session.
  await requireSupabase()
    .from("EV_Payments")
    .update({
      session_id: input.liveSessionId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.paymentId)
    .eq("user_id", uid);

  await applyPrepaidLimitsToLiveSession(input.liveSessionId, input.options, input.paymentId);

  await requireSupabase()
    .from("EV_ChargingSessions")
    .update({
      status: "cancelled",
      end_time: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.pendingSessionId)
    .eq("user_id", uid)
    .eq("status", "pending_payment");
}

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
  const session = await sessionService.startSession(chargerId, connectorId, uid, {
    prepaidPaid: options?.paymentStatus === "paid",
    paymentId: undefined,
  });

  const hasPrepaid =
    (options?.prepaidTotalInr != null && options.prepaidTotalInr > 0) ||
    (options?.prepaidAmount != null && options.prepaidAmount > 0) ||
    options?.prepaidMode != null;

  if (hasPrepaid && options?.paymentStatus === "paid") {
    await applyPrepaidLimitsToLiveSession(session.id, {
      ...options,
      paymentStatus: "paid",
    });
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
    tariff: ChargerTariff;
  }
): StartChargingPrepaidOptions {
  const calc = input.calculation;
  const tariff = input.tariff;

  // Amount mode: energy cap from (base - session fee) / rate; time mode uses duration only.
  const energyCap =
    input.mode === "amount" && calc.estimatedKwh != null && calc.estimatedKwh > 0
      ? calc.estimatedKwh
      : undefined;

  const tariffId = tariff.id.startsWith("fallback-") ? undefined : tariff.id;

  return {
    prepaidAmount: calc.totalAmount,
    targetKwh: calc.estimatedKwh ?? energyCap,
    tariffId,
    ratePerKwhSnapshot: tariff.ratePerKwh,
    sessionFeeSnapshot: tariff.sessionFee,
    gstPercentSnapshot: tariff.gstPercent,
    prepaidMode: input.mode,
    prepaidValue: input.prepaidValue,
    prepaidTotalInr: calc.totalAmount,
    prepaidEnergyCapKwh: energyCap,
    prepaidPlanId: input.planId ?? undefined,
    prepaidExpiresAt: undefined,
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
