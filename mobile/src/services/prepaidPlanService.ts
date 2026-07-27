import {
  DEFAULT_AC_FALLBACK_KW,
  DEFAULT_DC_FALLBACK_KW,
} from "../config/tariffConfig";
import { requireSupabase } from "../utils/supabaseClient";
import type { Charger, EVPrepaidPlan, PrepaidMode, PrepaidPaymentCalculation } from "../types";
import * as tariffService from "./tariffService";
import type { ChargerTariff } from "./tariffService";
import {
  calculateAmountPayment,
  calculateTimePayment,
} from "../utils/prepaidPayment";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function mapPrepaidPlan(row: Record<string, unknown>): EVPrepaidPlan {
  const modeRaw = String(row.mode ?? row.plan_type ?? row.type ?? row.category ?? "").toLowerCase();
  const amount =
    row.amount != null
      ? Number(row.amount)
      : modeRaw === "amount" || modeRaw === ""
        ? Number(row.value ?? 0)
        : null;
  const durationMinutes =
    row.duration_minutes != null
      ? Number(row.duration_minutes)
      : modeRaw === "time"
        ? Number(row.value ?? 0)
        : null;

  let mode: PrepaidMode = "amount";
  if (modeRaw === "time" || modeRaw === "duration") {
    mode = "time";
  } else if (modeRaw === "amount" || modeRaw === "price") {
    mode = "amount";
  } else if (durationMinutes != null && durationMinutes > 0 && !(amount != null && amount > 0)) {
    mode = "time";
  } else if (amount != null && amount > 0 && (durationMinutes == null || durationMinutes <= 0)) {
    mode = "amount";
  } else if (durationMinutes != null && durationMinutes > 0) {
    mode = "time";
  }

  const value =
    mode === "time"
      ? Number(durationMinutes ?? row.value ?? 0)
      : Number(amount ?? row.value ?? 0);

  return {
    id: String(row.id),
    name: String(row.label ?? row.name ?? ""),
    mode,
    value,
    amount: amount != null && amount > 0 ? amount : mode === "amount" ? value : null,
    durationMinutes:
      durationMinutes != null && durationMinutes > 0
        ? durationMinutes
        : mode === "time"
          ? value
          : null,
    sortOrder: Number(row.sort_order ?? 0),
    isActive: row.is_active == null ? true : Boolean(row.is_active),
    label: row.label != null ? String(row.label) : null,
  };
}

export async function fetchPrepaidPlans(activeOnly = true): Promise<EVPrepaidPlan[]> {
  const { data, error } = await requireSupabase()
    .from("EV_PrepaidPlans")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(error.message || "No prepaid plans available");
  }

  let plans = ((data as Record<string, unknown>[]) ?? []).map(mapPrepaidPlan);
  if (activeOnly) {
    plans = plans.filter((p) => p.isActive);
  }
  return plans;
}

export function splitPrepaidPlans(plans: EVPrepaidPlan[]): {
  amountPlans: EVPrepaidPlan[];
  timePlans: EVPrepaidPlan[];
} {
  const amountPlans = plans
    .filter((p) => p.mode === "amount" && (p.amount ?? p.value) > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const timePlans = plans
    .filter((p) => p.mode === "time" && (p.durationMinutes ?? p.value) > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return { amountPlans, timePlans };
}

/** Parse kW from model/name e.g. SIM-60DC, TEST-60DC */
export function parsePowerKwFromText(...texts: Array<string | null | undefined>): number | null {
  for (const text of texts) {
    if (!text) continue;
    const strong = text.match(/(?:^|[-_\s])(\d+(?:\.\d+)?)(?:\s*)(?:kw|dc)\b/i);
    if (strong) {
      const n = Number(strong[1]);
      if (Number.isFinite(n) && n > 0 && n < 500) return n;
    }
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:kw|dc|ac)?/i);
    if (match) {
      const n = Number(match[1]);
      if (/kw|dc/i.test(text) && Number.isFinite(n) && n >= 3 && n <= 400) return n;
    }
  }
  return null;
}

export function resolveChargerPowerKw(charger: Pick<Charger, "maxPowerKw" | "type" | "name" | "model" | "chargePointId">): {
  powerKw: number;
  estimated: boolean;
} {
  if (charger.maxPowerKw != null && Number(charger.maxPowerKw) > 0) {
    return { powerKw: Number(charger.maxPowerKw), estimated: false };
  }

  const parsed = parsePowerKwFromText(charger.model, charger.name, charger.chargePointId);
  if (parsed != null) {
    return { powerKw: parsed, estimated: true };
  }

  const type = (charger.type || "").toLowerCase();
  if (type.includes("dc") || type.includes("fast")) {
    return { powerKw: DEFAULT_DC_FALLBACK_KW, estimated: true };
  }
  return { powerKw: DEFAULT_AC_FALLBACK_KW, estimated: true };
}

export async function calculateAmountPlanPayment(
  plan: EVPrepaidPlan,
  tariff: ChargerTariff
): Promise<PrepaidPaymentCalculation> {
  const base = Number(plan.amount ?? plan.value);
  if (!Number.isFinite(base) || base <= 0) {
    throw new Error("Unable to calculate amount");
  }
  return calculateAmountPayment(base, tariff);
}

export async function calculateTimePlanPayment(
  plan: EVPrepaidPlan,
  charger: Pick<Charger, "maxPowerKw" | "type" | "name" | "model" | "chargePointId" | "tariffId">,
  tariff?: ChargerTariff
): Promise<PrepaidPaymentCalculation> {
  const durationMinutes = Number(plan.durationMinutes ?? plan.value);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error("Unable to calculate amount");
  }

  const resolvedTariff = tariff ?? (await tariffService.getTariffForCharger(charger));
  return calculateTimePayment(charger, durationMinutes, resolvedTariff);
}

export async function calculatePrepaidPlanPayment(
  plan: EVPrepaidPlan,
  charger: Pick<Charger, "maxPowerKw" | "type" | "name" | "model" | "chargePointId" | "tariffId">
): Promise<PrepaidPaymentCalculation> {
  const tariff = await tariffService.getTariffForCharger(charger);
  if (plan.mode === "time") {
    return calculateTimePlanPayment(plan, charger, tariff);
  }
  return calculateAmountPlanPayment(plan, tariff);
}

export function formatPrepaidPlanLabel(plan: EVPrepaidPlan): string {
  if (plan.label || plan.name) return plan.label || plan.name;
  if (plan.mode === "time") {
    const mins = Number(plan.durationMinutes ?? plan.value);
    if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
    return `${mins} min`;
  }
  const amount = Number(plan.amount ?? plan.value);
  return `₹${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
}

// Re-export prepaid helpers used by the mobile modal (single source in utils/prepaidPayment).
export {
  MIN_PREPAID_AMOUNT,
  MAX_PREPAID_AMOUNT,
  MIN_PREPAID_MINUTES,
  MAX_PREPAID_MINUTES,
  validatePrepaidAmount,
  validatePrepaidMinutes,
  calculateAmountPayment,
  calculateTimePayment,
  sanitizeAmountInput,
  sanitizeMinutesInput,
} from "../utils/prepaidPayment";
