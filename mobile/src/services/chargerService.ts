import { requireSupabase } from "../utils/supabaseClient";
import { isOfflineByHeartbeat, isOnlineByHeartbeat } from "../utils/chargerConnectivity";
import { sortChargersByDistance } from "./locationService";
import { parseChargeQr } from "../utils/qrParser";
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
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    lastHeartbeat: (row.last_heartbeat_at as string) ?? null,
    isSimulated: Boolean(row.is_simulated),
    connectors: connectors.map(mapConnector),
  };
}

export async function getChargers(query: ChargersQuery = {}): Promise<Charger[]> {
  const { status = "all", search = "", onlineOnly = false } = query;

  let q = requireSupabase()
    .from("EV_Chargers")
    .select("*, EV_ChargerConnectors(*)")
    .order("name");

  if (onlineOnly) {
    // legacy: treat as heartbeat-online after fetch
  } else if (status !== "all" && status !== "online" && status !== "offline") {
    q = q.eq("status", status);
  }

  const s = search.trim();
  if (s) {
    q = q.or(`name.ilike.%${s}%,charge_point_id.ilike.%${s}%,location.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  let list = (data ?? []).map((row) => mapCharger(row as Record<string, unknown>));

  if (onlineOnly || status === "online") {
    list = list.filter((c) => isOnlineByHeartbeat(c.lastHeartbeat));
  } else if (status === "offline") {
    list = list.filter((c) => isOfflineByHeartbeat(c.lastHeartbeat));
  } else if (status === "faulted") {
    list = list.filter((c) => c.status === "Faulted");
  }

  return list;
}

/** @deprecated use getNearestChargers */
export async function getNearbyChargers(): Promise<Charger[]> {
  return getChargers({ onlineOnly: true });
}

export async function getNearestChargers(
  userLat: number,
  userLng: number,
  limit = 20
): Promise<Charger[]> {
  const list = await getChargers({ onlineOnly: true });
  return sortChargersByDistance(list, { latitude: userLat, longitude: userLng }).slice(0, limit);
}

export interface QrValidationResult {
  charger: Charger;
  connectorId: number;
}

export async function validateQr(raw: string): Promise<QrValidationResult> {
  const parsed = parseChargeQr(raw);
  if (!parsed) throw new Error("INVALID_QR");

  let charger: Charger | undefined;
  if (parsed.chargerId) {
    charger = await getChargerById(parsed.chargerId);
  } else if (parsed.chargePointId) {
    charger = await getChargerByChargePointId(parsed.chargePointId);
  }

  if (!charger) throw new Error("CHARGER_NOT_FOUND");

  const connector = charger.connectors.find((c) => c.connectorId === parsed.connectorId);
  if (!connector) throw new Error("CONNECTOR_NOT_FOUND");
  if (!isConnectorAvailable(connector.status)) {
    throw new Error("CONNECTOR_NOT_AVAILABLE");
  }

  return { charger, connectorId: parsed.connectorId };
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
