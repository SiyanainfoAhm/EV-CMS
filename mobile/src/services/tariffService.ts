import { requireSupabase } from "../utils/supabaseClient";
import type { Charger } from "../types";

/** Tariff row from public."EV_Tariffs" used for prepaid calculation. */
export type ChargerTariff = {
  id: string;
  name: string;
  ratePerKwh: number;
  sessionFee: number;
  gstPercent: number;
  appliesTo: string;
  /** True when values come from hardcoded fallback (no DB row). */
  isFallback?: boolean;
};

export type ChargeInputMode = "amount" | "kwh";

export type ChargerTariffInput = Pick<
  Charger,
  "tariffId" | "type" | "maxPowerKw" | "model" | "name" | "chargePointId"
>;

const FALLBACK_AC: ChargerTariff = {
  id: "fallback-ac-slow",
  name: "AC Slow Charging - Standard",
  ratePerKwh: 8,
  sessionFee: 0,
  gstPercent: 18,
  appliesTo: "AC Slow",
  isFallback: true,
};

const FALLBACK_DC: ChargerTariff = {
  id: "fallback-dc-fast",
  name: "DC Fast Charging - Standard",
  ratePerKwh: 15,
  sessionFee: 20,
  gstPercent: 18,
  appliesTo: "DC Fast",
  isFallback: true,
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function mapTariff(row: Record<string, unknown>): ChargerTariff {
  return {
    id: String(row.id),
    name: String(row.name),
    ratePerKwh: Number(row.rate_per_kwh),
    sessionFee: Number(row.session_fee ?? 0),
    gstPercent: Number(row.gst_percent ?? 18),
    appliesTo: String(row.applies_to ?? ""),
    isFallback: false,
  };
}

/**
 * Normalize charger type for EV_Tariffs.applies_to matching.
 */
export function normalizeChargerType(
  charger: Pick<Charger, "type" | "maxPowerKw" | "model" | "name">
): "AC Slow" | "DC Fast" {
  const type = String(charger.type || "")
    .toLowerCase()
    .trim();
  const model = String(charger.model || charger.name || "").toLowerCase();

  if (type.includes("dc fast") || type === "dc" || type.includes("dc")) {
    return "DC Fast";
  }
  if (type.includes("ac slow") || type === "ac" || type.includes("ac")) {
    return "AC Slow";
  }
  if (model.includes("60dc")) {
    return "DC Fast";
  }
  const kw = Number(charger.maxPowerKw ?? 0);
  if (kw >= 25) {
    return "DC Fast";
  }
  return "AC Slow";
}

function fallbackTariffForType(appliesTo: "AC Slow" | "DC Fast"): ChargerTariff {
  return appliesTo === "DC Fast" ? { ...FALLBACK_DC } : { ...FALLBACK_AC };
}

export async function getTariffById(id: string): Promise<ChargerTariff | null> {
  const { data, error } = await requireSupabase()
    .from("EV_Tariffs")
    .select("id, name, rate_per_kwh, session_fee, gst_percent, applies_to, is_active")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const mapped = mapTariff(data as Record<string, unknown>);
  return mapped.ratePerKwh > 0 ? mapped : null;
}

async function getTariffByAppliesTo(appliesTo: string): Promise<ChargerTariff | null> {
  const { data, error } = await requireSupabase()
    .from("EV_Tariffs")
    .select("id, name, rate_per_kwh, session_fee, gst_percent, applies_to, is_active")
    .eq("is_active", true)
    .ilike("applies_to", appliesTo)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const mapped = mapTariff(data as Record<string, unknown>);
  return mapped.ratePerKwh > 0 ? mapped : null;
}

/**
 * Resolve tariff for a charger:
 * A) charger.tariff_id → EV_Tariffs
 * B) applies_to matches normalized charger type
 * C) hardcoded AC/DC fallback (never ₹7.70)
 */
export async function getTariffForCharger(
  charger: ChargerTariffInput
): Promise<ChargerTariff> {
  const normalizedType = normalizeChargerType(charger);

  if (charger.tariffId) {
    const linked = await getTariffById(charger.tariffId);
    if (linked) {
      console.log("[tariff] resolved by tariff_id", {
        charger_type: charger.type,
        normalized_type: normalizedType,
        tariff_id: linked.id,
        tariff_name: linked.name,
        rate_per_kwh: linked.ratePerKwh,
        session_fee: linked.sessionFee,
        gst_percent: linked.gstPercent,
      });
      return linked;
    }
  }

  const byType = await getTariffByAppliesTo(normalizedType);
  if (byType) {
    console.log("[tariff] resolved by applies_to", {
      charger_type: charger.type,
      normalized_type: normalizedType,
      tariff_id: byType.id,
      tariff_name: byType.name,
      rate_per_kwh: byType.ratePerKwh,
      session_fee: byType.sessionFee,
      gst_percent: byType.gstPercent,
    });
    return byType;
  }

  const fallback = fallbackTariffForType(normalizedType);
  console.warn("[tariff] using type fallback (no EV_Tariffs row)", {
    charger_type: charger.type,
    normalized_type: normalizedType,
    rate_per_kwh: fallback.ratePerKwh,
    session_fee: fallback.sessionFee,
    gst_percent: fallback.gstPercent,
  });
  return fallback;
}

/** @deprecated Use getTariffForCharger(charger) */
export async function getTariffForChargerLegacy(input: {
  tariffId?: string | null;
  type?: string | null;
}): Promise<ChargerTariff> {
  return getTariffForCharger({
    tariffId: input.tariffId,
    type: input.type ?? "",
    maxPowerKw: 0,
    model: null,
    name: "",
    chargePointId: "",
  });
}

export type ActiveTariff = ChargerTariff;

export async function getActiveChargingTariff(): Promise<ChargerTariff | null> {
  const client = requireSupabase();

  const { data: defaultRow, error: defaultErr } = await client
    .from("EV_Tariffs")
    .select("id, name, rate_per_kwh, session_fee, gst_percent, applies_to, is_default, is_active")
    .eq("is_active", true)
    .eq("is_default", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!defaultErr && defaultRow) {
    return mapTariff(defaultRow as Record<string, unknown>);
  }

  const { data, error } = await client
    .from("EV_Tariffs")
    .select("id, name, rate_per_kwh, session_fee, gst_percent, applies_to, is_default, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapTariff(data as Record<string, unknown>);
}

/** kWh from ₹ energy budget at tariff rate (ex-GST base, after session fee deduction). */
export function estimateKwhForAmount(amountInr: number, ratePerKwh: number): number {
  if (ratePerKwh <= 0 || amountInr <= 0) return 0;
  return round3(amountInr / ratePerKwh);
}

/** Energy budget for prepaid amount (session fee deducted from base at settlement). */
export function energyBudgetForPrepaidAmount(baseAmount: number, sessionFee: number): number {
  return round2(Math.max(0, baseAmount - Math.max(0, sessionFee)));
}

/** ₹ amount from kWh at tariff rate (energy cost, ex-GST). */
export function estimateAmountForKwh(energyKwh: number, ratePerKwh: number): number {
  if (ratePerKwh <= 0 || energyKwh <= 0) return 0;
  return round2(energyKwh * ratePerKwh);
}

export function resolveChargeFromInput(
  mode: ChargeInputMode,
  value: number,
  tariff: Pick<ChargerTariff, "ratePerKwh" | "sessionFee">
): { prepaidAmount: number; targetKwh: number } {
  if (mode === "amount") {
    const budget = energyBudgetForPrepaidAmount(value, tariff.sessionFee);
    return {
      prepaidAmount: round2(value),
      targetKwh: estimateKwhForAmount(budget, tariff.ratePerKwh),
    };
  }
  return {
    targetKwh: round3(value),
    prepaidAmount: estimateAmountForKwh(value, tariff.ratePerKwh),
  };
}
