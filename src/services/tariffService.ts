import type { Tariff } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapTariff } from "@/utils/supabaseMappers";

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
