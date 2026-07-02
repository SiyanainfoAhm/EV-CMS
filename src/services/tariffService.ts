import type { Tariff } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapTariff } from "@/utils/supabaseMappers";
import { calculateSessionBillFromTariff } from "@/utils/tariffBilling";

export async function getTariffs(): Promise<Tariff[]> {
  const { data, error } = await requireSupabase()
    .from("EV_Tariffs")
    .select("*")
    .order("name");

  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map(mapTariff);
}

export async function getActiveTariffs(): Promise<Tariff[]> {
  const tariffs = await getTariffs();
  return tariffs.filter((t) => t.isActive);
}

export interface TariffInput {
  name: string;
  ratePerKwh: number;
  sessionFee: number;
  gstPercent: number;
  appliesTo: string;
  isActive?: boolean;
}

export async function getDefaultTariff(): Promise<Tariff | null> {
  const { data, error } = await requireSupabase()
    .from("EV_Tariffs")
    .select("*")
    .eq("is_active", true)
    .eq("is_default", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapTariff(data as Record<string, unknown>);
}

export async function calculateBillForEnergy(
  energyKwh: number,
  tariffId?: string | null
): Promise<ReturnType<typeof calculateSessionBillFromTariff> & { tariffId: string }> {
  let tariff: Tariff | null = null;
  if (tariffId) {
    tariff = await getTariffById(tariffId);
  }
  if (!tariff?.isActive) {
    tariff = await getDefaultTariff();
  }
  if (!tariff) {
    throw new Error("No active tariff configured");
  }
  return {
    tariffId: tariff.id,
    ...calculateSessionBillFromTariff(energyKwh, {
      ratePerKwh: tariff.ratePerKwh,
      gstPercent: tariff.gstPercent,
    }),
  };
}

export async function getTariffById(id: string): Promise<Tariff | null> {
  const { data, error } = await requireSupabase()
    .from("EV_Tariffs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapTariff(data as Record<string, unknown>);
}

export async function getActiveTariffByType(chargerType: string): Promise<Tariff | null> {
  const { data, error } = await requireSupabase()
    .from("EV_Tariffs")
    .select("*")
    .eq("is_active", true)
    .eq("applies_to", chargerType)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapTariff(data as Record<string, unknown>);
}

/** Resolve tariff: per-charger override first, then type default. */
export async function resolveTariffForCharger(charger: {
  tariffId?: string | null;
  type: string;
}): Promise<Tariff | null> {
  if (charger.tariffId) {
    const assigned = await getTariffById(charger.tariffId);
    if (assigned?.isActive) return assigned;
  }
  return getActiveTariffByType(charger.type);
}

export function formatTariffSummary(tariff: Tariff): string {
  const fee = tariff.sessionFee > 0 ? ` + ₹${tariff.sessionFee.toFixed(2)} session fee` : "";
  return `₹${tariff.ratePerKwh.toFixed(2)}/kWh${fee} (${tariff.gstPercent}% GST)`;
}

export async function getTariffsForChargerType(chargerType: string): Promise<Tariff[]> {
  const tariffs = await getActiveTariffs();
  return tariffs.filter((t) => t.appliesTo === chargerType);
}

export async function createTariff(input: TariffInput): Promise<Tariff> {
  const { data, error } = await requireSupabase()
    .from("EV_Tariffs")
    .insert({
      name: input.name,
      rate_per_kwh: input.ratePerKwh,
      session_fee: input.sessionFee,
      gst_percent: input.gstPercent,
      applies_to: input.appliesTo,
      is_active: input.isActive ?? true,
    })
    .select()
    .single();

  if (error) throw error;
  return mapTariff(data as Record<string, unknown>);
}

export async function updateTariff(id: string, input: TariffInput): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_Tariffs")
    .update({
      name: input.name,
      rate_per_kwh: input.ratePerKwh,
      session_fee: input.sessionFee,
      gst_percent: input.gstPercent,
      applies_to: input.appliesTo,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw error;
}

export async function toggleTariffActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_Tariffs")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
}
