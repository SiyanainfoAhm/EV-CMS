import { requireSupabase } from "../utils/supabaseClient";
import type { Charger, ChargerConnector } from "../types";

export interface ChargersQuery {
  status?: string;
  search?: string;
  onlineOnly?: boolean;
}

function mapConnector(c: Record<string, unknown>): ChargerConnector {
  return {
    id: c.id as string,
    connectorId: c.connector_id as number,
    type: c.connector_type as string,
    maxPowerKw: Number(c.max_power_kw),
    status: c.status as string,
  };
}

function mapCharger(row: Record<string, unknown>): Charger {
  const connectors = (row.EV_ChargerConnectors as Record<string, unknown>[]) ?? [];
  return {
    id: row.id as string,
    chargePointId: row.charge_point_id as string,
    name: row.name as string,
    type: row.charger_type as string,
    maxPowerKw: Number(row.max_power_kw),
    status: row.status as string,
    location: (row.location as string) ?? "",
    connectors: connectors.map(mapConnector),
  };
}

export async function getChargers(query: ChargersQuery = {}): Promise<Charger[]> {
  const { status = "all", search = "", onlineOnly = false } = query;

  let q = requireSupabase()
    .from("EV_Chargers")
    .select("*, EV_ChargerConnectors(*)")
    .order("name");

  if (onlineOnly) q = q.eq("status", "online");
  else if (status !== "all") q = q.eq("status", status);

  const s = search.trim();
  if (s) {
    q = q.or(`name.ilike.%${s}%,charge_point_id.ilike.%${s}%,location.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((row) => mapCharger(row as Record<string, unknown>));
}

/** @deprecated use getChargers */
export async function getNearbyChargers(): Promise<Charger[]> {
  return getChargers({ onlineOnly: true });
}

export async function getChargerById(id: string): Promise<Charger | undefined> {
  const { data, error } = await requireSupabase()
    .from("EV_Chargers")
    .select("*, EV_ChargerConnectors(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapCharger(data as Record<string, unknown>) : undefined;
}

export async function getChargerByChargePointId(chargePointId: string): Promise<Charger | undefined> {
  const { data, error } = await requireSupabase()
    .from("EV_Chargers")
    .select("*, EV_ChargerConnectors(*)")
    .eq("charge_point_id", chargePointId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapCharger(data as Record<string, unknown>) : undefined;
}

export function isConnectorAvailable(status: string): boolean {
  return status.toLowerCase() === "available";
}
