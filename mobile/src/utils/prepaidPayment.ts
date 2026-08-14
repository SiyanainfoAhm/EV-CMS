import {
  DEFAULT_AC_FALLBACK_KW,
  DEFAULT_DC_FALLBACK_KW,
} from "../config/tariffConfig";
import type { ChargerTariff } from "../services/tariffService";
import type { Charger, PrepaidMode, PrepaidPaymentCalculation } from "../types";

export const MIN_PREPAID_AMOUNT = 50;
export const MAX_PREPAID_AMOUNT = 10000;
export const MIN_PREPAID_MINUTES = 10;
export const MAX_PREPAID_MINUTES = 240;

export const DEFAULT_AMOUNT_CHIPS = [50, 100, 500, 1000] as const;
export const DEFAULT_TIME_CHIPS_MINUTES = [10, 15, 30, 60, 120] as const;

export type PrepaidValidationResult = {
  valid: boolean;
  value: number | null;
  error: string | null;
};

export type PrepaidOrderPayloadBase = {
  charger_id: string;
  charge_point_id: string;
  charger_type: string;
  tariff_id: string;
  tariff_name: string;
  rate_per_kwh: number;
  session_fee: number;
  gst_percent: number;
  energy_amount: number;
  subtotal: number;
  gst_amount: number;
  total_amount: number;
};

export type PrepaidAmountOrderPayload = PrepaidOrderPayloadBase & {
  plan_mode: "amount";
  plan_id: string | null;
  custom_amount: number | null;
  base_amount: number;
};

export type PrepaidTimeOrderPayload = PrepaidOrderPayloadBase & {
  plan_mode: "time";
  plan_id: string | null;
  custom_duration_minutes: number | null;
  duration_minutes: number;
  charger_power_kw: number;
  estimated_kwh: number;
  base_amount: number;
};

export type PrepaidPaymentOrderPayload = PrepaidAmountOrderPayload | PrepaidTimeOrderPayload;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Allow digits + one decimal, max 2 decimal places. Blocks minus/letters. */
export function sanitizeAmountInput(value: string): string {
  let cleaned = value.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    cleaned =
      cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
    const [whole, frac = ""] = cleaned.split(".");
    cleaned = `${whole}.${frac.slice(0, 2)}`;
  }
  return cleaned;
}

/** Positive integers only — no minus, decimal, or letters. */
export function sanitizeMinutesInput(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

export function validatePrepaidAmount(amount: unknown): PrepaidValidationResult {
  if (amount === "" || amount == null) {
    return { valid: false, value: null, error: "Enter a valid amount" };
  }

  const raw = typeof amount === "number" ? amount : Number(String(amount).trim());
  if (!Number.isFinite(raw)) {
    return { valid: false, value: null, error: "Enter a valid amount" };
  }
  if (raw < 0) {
    return { valid: false, value: raw, error: "Amount cannot be negative" };
  }
  if (raw === 0) {
    return { valid: false, value: raw, error: "Enter a valid amount" };
  }

  const decimals = String(amount).includes(".")
    ? String(amount).split(".")[1]?.length ?? 0
    : 0;
  if (decimals > 2) {
    return { valid: false, value: raw, error: "Enter a valid amount" };
  }

  if (raw < MIN_PREPAID_AMOUNT) {
    return { valid: false, value: raw, error: "Minimum prepaid amount is ₹50" };
  }
  if (raw > MAX_PREPAID_AMOUNT) {
    return { valid: false, value: raw, error: "Maximum prepaid amount is ₹10,000" };
  }

  return { valid: true, value: round2(raw), error: null };
}

export function validatePrepaidMinutes(minutes: unknown): PrepaidValidationResult {
  if (minutes === "" || minutes == null) {
    return { valid: false, value: null, error: "Enter a valid duration" };
  }

  const rawStr = String(minutes).trim();
  if (!/^\d+$/.test(rawStr)) {
    return { valid: false, value: null, error: "Enter a valid duration" };
  }

  const raw = Number(rawStr);
  if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
    return { valid: false, value: null, error: "Enter a valid duration" };
  }
  if (raw < 0) {
    return { valid: false, value: raw, error: "Duration cannot be negative" };
  }
  if (raw === 0) {
    return { valid: false, value: raw, error: "Enter a valid duration" };
  }
  if (raw < MIN_PREPAID_MINUTES) {
    return { valid: false, value: raw, error: "Minimum duration is 10 minutes" };
  }
  if (raw > MAX_PREPAID_MINUTES) {
    return { valid: false, value: raw, error: "Maximum duration is 240 minutes" };
  }

  return { valid: true, value: raw, error: null };
}

/**
 * Charge by Amount Limit — selected ₹ is the **final bill limit** (incl. GST).
 *
 * finalAmountLimit = selectedAmount
 * subtotalLimit = finalAmountLimit / (1 + gst/100)
 * energyBudget = subtotalLimit - sessionFee
 * kwhLimit = energyBudget / ratePerKwh
 *
 * Example DC Fast ₹50, rate 15, fee 20, GST 18% → ~1.491 kWh.
 */
export function calculateAmountPayment(amount: number, tariff: ChargerTariff): PrepaidPaymentCalculation {
  const finalAmountLimit = round2(amount);
  const gstPercent = Number(tariff.gstPercent) || 0;
  const divisor = 1 + gstPercent / 100;
  const subtotalLimit = divisor > 0 ? round2(finalAmountLimit / divisor) : finalAmountLimit;
  const gstAmount = round2(finalAmountLimit - subtotalLimit);
  const sessionFee = Math.max(0, Number(tariff.sessionFee) || 0);
  const energyBudget = round2(subtotalLimit - sessionFee);
  const estimatedKwh =
    energyBudget > 0 && tariff.ratePerKwh > 0
      ? round3(energyBudget / tariff.ratePerKwh)
      : null;

  return {
    baseAmount: subtotalLimit,
    gstAmount,
    totalAmount: finalAmountLimit,
    gstPercent,
    estimatedKwh,
    durationMinutes: null,
    ratePerKwh: tariff.ratePerKwh,
    sessionFee,
    energyAmount: Math.max(0, energyBudget),
    subtotal: subtotalLimit,
    tariffId: tariff.id,
    tariffName: tariff.name,
    powerKw: null,
    powerEstimated: false,
  };
}

/** True when selected amount limit can buy any energy after fee + GST. */
export function isAmountLimitFeasible(calculation: PrepaidPaymentCalculation): boolean {
  return (
    calculation.estimatedKwh != null &&
    calculation.estimatedKwh > 0 &&
    (calculation.energyAmount ?? 0) > 0
  );
}

export const AMOUNT_LIMIT_TOO_LOW =
  "Amount limit is too low for this charger tariff.";

export function resolveChargerPowerKwForPayment(
  charger: Pick<Charger, "maxPowerKw" | "type" | "name" | "model" | "chargePointId">
): { powerKw: number; estimated: boolean } {
  if (charger.maxPowerKw != null && Number(charger.maxPowerKw) > 0) {
    return { powerKw: Number(charger.maxPowerKw), estimated: false };
  }

  const type = (charger.type || "").toLowerCase();
  const model = String(charger.model || charger.name || "").toLowerCase();
  if (model.includes("60dc") || type.includes("dc")) {
    return { powerKw: DEFAULT_DC_FALLBACK_KW, estimated: true };
  }
  if (type.includes("ac")) {
    return { powerKw: DEFAULT_AC_FALLBACK_KW, estimated: true };
  }
  const kw = Number(charger.maxPowerKw ?? 0);
  if (kw >= 25) {
    return { powerKw: DEFAULT_DC_FALLBACK_KW, estimated: true };
  }
  return { powerKw: DEFAULT_AC_FALLBACK_KW, estimated: true };
}

/**
 * Pay by Time — energy + session fee + GST on subtotal.
 * DC Fast 60 kW × 10 min → ₹200.60 (see product spec).
 */
export function calculateTimePayment(
  charger: Pick<Charger, "maxPowerKw" | "type" | "name" | "model" | "chargePointId">,
  durationMinutes: number,
  tariff: ChargerTariff
): PrepaidPaymentCalculation {
  const { powerKw, estimated } = resolveChargerPowerKwForPayment(charger);
  const durationHours = durationMinutes / 60;
  const estimatedKwh = round3(powerKw * durationHours);
  const energyAmount = round2(estimatedKwh * tariff.ratePerKwh);
  const sessionFee = round2(tariff.sessionFee || 0);
  const subtotal = round2(energyAmount + sessionFee);
  const gstAmount = round2(subtotal * (tariff.gstPercent / 100));
  const totalAmount = round2(subtotal + gstAmount);

  return {
    baseAmount: subtotal,
    gstAmount,
    totalAmount,
    gstPercent: tariff.gstPercent,
    estimatedKwh,
    durationMinutes,
    ratePerKwh: tariff.ratePerKwh,
    sessionFee,
    energyAmount,
    subtotal,
    tariffId: tariff.id,
    tariffName: tariff.name,
    powerKw,
    powerEstimated: estimated,
  };
}

function tariffPayloadFields(
  tariff: ChargerTariff,
  calculation: PrepaidPaymentCalculation
): Pick<
  PrepaidOrderPayloadBase,
  | "tariff_id"
  | "tariff_name"
  | "rate_per_kwh"
  | "session_fee"
  | "gst_percent"
  | "energy_amount"
  | "subtotal"
  | "gst_amount"
  | "total_amount"
> {
  return {
    tariff_id: tariff.id,
    tariff_name: tariff.name,
    rate_per_kwh: tariff.ratePerKwh,
    session_fee: tariff.sessionFee,
    gst_percent: tariff.gstPercent,
    energy_amount: calculation.energyAmount ?? calculation.baseAmount,
    subtotal: calculation.subtotal ?? calculation.baseAmount,
    gst_amount: calculation.gstAmount,
    total_amount: calculation.totalAmount,
  };
}

export function buildAmountOrderPayload(input: {
  charger: Pick<Charger, "id" | "chargePointId" | "type">;
  tariff: ChargerTariff;
  planId: string | null;
  isCustom: boolean;
  amount: number;
  calculation: PrepaidPaymentCalculation;
}): PrepaidAmountOrderPayload {
  return {
    plan_mode: "amount",
    plan_id: input.isCustom ? null : input.planId,
    custom_amount: input.isCustom ? input.amount : null,
    base_amount: input.calculation.baseAmount,
    charger_id: input.charger.id,
    charge_point_id: input.charger.chargePointId,
    charger_type: input.charger.type,
    ...tariffPayloadFields(input.tariff, input.calculation),
  };
}

export function buildTimeOrderPayload(input: {
  charger: Pick<Charger, "id" | "chargePointId" | "type">;
  tariff: ChargerTariff;
  planId: string | null;
  isCustom: boolean;
  durationMinutes: number;
  calculation: PrepaidPaymentCalculation;
}): PrepaidTimeOrderPayload {
  return {
    plan_mode: "time",
    plan_id: input.isCustom ? null : input.planId,
    custom_duration_minutes: input.isCustom ? input.durationMinutes : null,
    duration_minutes: input.durationMinutes,
    charger_power_kw: input.calculation.powerKw ?? 0,
    estimated_kwh: input.calculation.estimatedKwh ?? 0,
    base_amount: input.calculation.subtotal ?? input.calculation.baseAmount,
    charger_id: input.charger.id,
    charge_point_id: input.charger.chargePointId,
    charger_type: input.charger.type,
    ...tariffPayloadFields(input.tariff, input.calculation),
  };
}

export function formatTimeChipLabel(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return `${minutes} min`;
}

export function matchPlanIdByValue(
  plans: Array<{ id: string; mode: PrepaidMode; value: number; amount: number | null; durationMinutes: number | null }>,
  mode: PrepaidMode,
  value: number
): string | null {
  const match = plans.find((p) => {
    if (p.mode !== mode) return false;
    const planValue = mode === "amount" ? Number(p.amount ?? p.value) : Number(p.durationMinutes ?? p.value);
    return Math.abs(planValue - value) < 0.001;
  });
  return match?.id ?? null;
}

/** Debug log for prepaid tariff/payment flow. */
export function logPrepaidCalculation(
  label: string,
  data: Record<string, unknown>
): void {
  console.log(`[prepaid] ${label}`, data);
}
