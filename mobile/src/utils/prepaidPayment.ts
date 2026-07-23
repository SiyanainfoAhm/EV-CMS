import {
  DEFAULT_AC_FALLBACK_KW,
  DEFAULT_DC_FALLBACK_KW,
  getEvRatePerKwh,
} from "../config/tariffConfig";
import type { Charger, PrepaidMode, PrepaidPaymentCalculation } from "../types";

export const MIN_PREPAID_AMOUNT = 50;
export const MAX_PREPAID_AMOUNT = 10000;
export const MIN_PREPAID_MINUTES = 10;
export const MAX_PREPAID_MINUTES = 240;
export const PREPAID_GST_PERCENT = 18;

export const DEFAULT_AMOUNT_CHIPS = [50, 100, 500, 1000] as const;
export const DEFAULT_TIME_CHIPS_MINUTES = [10, 15, 30, 60, 120] as const;

export type PrepaidValidationResult = {
  valid: boolean;
  value: number | null;
  error: string | null;
};

export type PrepaidAmountOrderPayload = {
  plan_mode: "amount";
  plan_id: string | null;
  custom_amount: number | null;
  base_amount: number;
  gst_amount: number;
  total_amount: number;
};

export type PrepaidTimeOrderPayload = {
  plan_mode: "time";
  plan_id: string | null;
  custom_duration_minutes: number | null;
  duration_minutes: number;
  charger_power_kw: number;
  rate_per_kwh: number;
  estimated_kwh: number;
  base_amount: number;
  gst_amount: number;
  total_amount: number;
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

export function calculateAmountPayment(
  amount: number,
  ratePerKwh: number = getEvRatePerKwh()
): PrepaidPaymentCalculation {
  const baseAmount = round2(amount);
  const gstAmount = round2(baseAmount * (PREPAID_GST_PERCENT / 100));
  const rate = ratePerKwh > 0 ? ratePerKwh : getEvRatePerKwh();
  const estimatedKwh = rate > 0 ? round3(baseAmount / rate) : null;
  return {
    baseAmount,
    gstAmount,
    totalAmount: round2(baseAmount + gstAmount),
    gstPercent: PREPAID_GST_PERCENT,
    estimatedKwh,
    durationMinutes: null,
    ratePerKwh: rate,
    powerKw: null,
    powerEstimated: false,
  };
}

export function resolveChargerPowerKwForPayment(
  charger: Pick<Charger, "maxPowerKw" | "type" | "name" | "model" | "chargePointId">
): { powerKw: number; estimated: boolean } {
  if (charger.maxPowerKw != null && Number(charger.maxPowerKw) > 0) {
    return { powerKw: Number(charger.maxPowerKw), estimated: false };
  }

  const type = (charger.type || "").toLowerCase();
  if (type.includes("dc") || type.includes("fast")) {
    return { powerKw: DEFAULT_DC_FALLBACK_KW, estimated: true };
  }
  return { powerKw: DEFAULT_AC_FALLBACK_KW, estimated: true };
}

export function calculateTimePayment(
  charger: Pick<Charger, "maxPowerKw" | "type" | "name" | "model" | "chargePointId">,
  durationMinutes: number,
  ratePerKwh: number = getEvRatePerKwh()
): PrepaidPaymentCalculation {
  const { powerKw, estimated } = resolveChargerPowerKwForPayment(charger);
  const rate = ratePerKwh > 0 ? ratePerKwh : getEvRatePerKwh();
  const durationHours = durationMinutes / 60;
  const estimatedKwh = round3(powerKw * durationHours);
  const baseAmount = round2(estimatedKwh * rate);
  const gstAmount = round2(baseAmount * (PREPAID_GST_PERCENT / 100));

  return {
    baseAmount,
    gstAmount,
    totalAmount: round2(baseAmount + gstAmount),
    gstPercent: PREPAID_GST_PERCENT,
    estimatedKwh,
    durationMinutes,
    ratePerKwh: rate,
    powerKw,
    powerEstimated: estimated,
  };
}

export function buildAmountOrderPayload(input: {
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
    gst_amount: input.calculation.gstAmount,
    total_amount: input.calculation.totalAmount,
  };
}

export function buildTimeOrderPayload(input: {
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
    rate_per_kwh: input.calculation.ratePerKwh ?? getEvRatePerKwh(),
    estimated_kwh: input.calculation.estimatedKwh ?? 0,
    base_amount: input.calculation.baseAmount,
    gst_amount: input.calculation.gstAmount,
    total_amount: input.calculation.totalAmount,
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
