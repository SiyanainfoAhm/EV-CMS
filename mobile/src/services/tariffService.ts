import { requireSupabase } from "../utils/supabaseClient";

export type ActiveTariff = {
  id: string;
  name: string;
  ratePerKwh: number;
  gstPercent: number;
  region?: string | null;
};

export type ChargeInputMode = "amount" | "kwh";

export async function getActiveChargingTariff(): Promise<ActiveTariff | null> {
  const client = requireSupabase();

  const { data: defaultRow, error: defaultErr } = await client
    .from("EV_Tariffs")
    .select("id, name, rate_per_kwh, gst_percent, region, is_default, is_active")
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
    .select("id, name, rate_per_kwh, gst_percent, region, is_default, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapTariff(data as Record<string, unknown>);
}

function mapTariff(row: Record<string, unknown>): ActiveTariff {
  return {
    id: String(row.id),
    name: String(row.name),
    ratePerKwh: Number(row.rate_per_kwh),
    gstPercent: Number(row.gst_percent ?? 0),
    region: row.region != null ? String(row.region) : null,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** kWh from ₹ amount at tariff rate (energy estimate, ex-GST). */
export function estimateKwhForAmount(amountInr: number, ratePerKwh: number): number {
  if (ratePerKwh <= 0 || amountInr <= 0) return 0;
  return round3(amountInr / ratePerKwh);
}

/** ₹ amount from kWh at tariff rate (energy cost, ex-GST). */
export function estimateAmountForKwh(energyKwh: number, ratePerKwh: number): number {
  if (ratePerKwh <= 0 || energyKwh <= 0) return 0;
  return round2(energyKwh * ratePerKwh);
}

export function resolveChargeFromInput(
  mode: ChargeInputMode,
  value: number,
  ratePerKwh: number
): { prepaidAmount: number; targetKwh: number } {
  if (mode === "amount") {
    return {
      prepaidAmount: round2(value),
      targetKwh: estimateKwhForAmount(value, ratePerKwh),
    };
  }
  return {
    targetKwh: round3(value),
    prepaidAmount: estimateAmountForKwh(value, ratePerKwh),
  };
}
