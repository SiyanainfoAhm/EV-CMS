import { requireSupabase } from "../utils/supabaseClient";
import type { Charger } from "../types";

export async function getNearbyChargers(): Promise<Charger[]> {
  const { data, error } = await requireSupabase()
    .from("EV_Chargers")
    .select("*, EV_ChargerConnectors(*)")
    .eq("status", "online")
    .order("name");

  if (error) throw error;

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const connectors = (r.EV_ChargerConnectors as Record<string, unknown>[]) ?? [];
    return {
      id: r.id as string,
      chargePointId: r.charge_point_id as string,
      name: r.name as string,
      type: r.charger_type as string,
      maxPowerKw: Number(r.max_power_kw),
      status: r.status as string,
      location: (r.location as string) ?? "",
      distanceKm: 0.5,
      connectors: connectors.map((c) => ({
        id: c.id as string,
        connectorId: c.connector_id as number,
        type: c.connector_type as string,
        maxPowerKw: Number(c.max_power_kw),
        status: c.status as string,
      })),
    };
  });
}

export async function getChargerById(id: string): Promise<Charger | undefined> {
  const list = await getNearbyChargers();
  return list.find((c) => c.id === id);
}
