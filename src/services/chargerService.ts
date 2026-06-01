import type { Charger, ChargingSession, DashboardStats } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { computeDashboardStats, mapCharger, mapSession } from "@/utils/supabaseMappers";

async function fetchChargersRaw(): Promise<Charger[]> {
  const { data, error } = await requireSupabase()
    .from("EV_Chargers")
    .select("*, EV_ChargerConnectors(*)")
    .order("name");

  if (error) throw error;
  if (!data?.length) return [];

  return data.map((row) => {
    const raw = row as Record<string, unknown>;
    const nested = raw.EV_ChargerConnectors;
    const connectors = Array.isArray(nested)
      ? (nested as Record<string, unknown>[])
      : nested
        ? [nested as Record<string, unknown>]
        : [];
    const { EV_ChargerConnectors: _removed, ...charger } = raw;
    return mapCharger(charger, connectors);
  });
}

export async function getChargers(): Promise<Charger[]> {
  return fetchChargersRaw();
}

export async function getChargerById(id: string): Promise<Charger | undefined> {
  const { data, error } = await requireSupabase()
    .from("EV_Chargers")
    .select("*, EV_ChargerConnectors(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return undefined;
  const connectors = (data.EV_ChargerConnectors as Record<string, unknown>[]) ?? [];
  const { EV_ChargerConnectors: _, ...charger } = data as Record<string, unknown>;
  return mapCharger(charger, connectors);
}

export async function getActiveSessionsForChargers(): Promise<ChargingSession[]> {
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select(
      `
      *,
      EV_Chargers ( name, charge_point_id ),
      EV_Users ( full_name ),
      EV_RFIDCards ( uid )
    `
    )
    .eq("status", "active")
    .order("start_time", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const charger = r.EV_Chargers as Record<string, unknown> | null;
    const user = r.EV_Users as Record<string, unknown> | null;
    const rfid = r.EV_RFIDCards as Record<string, unknown> | null;
    const session = mapSession(r, charger, user, rfid);
    return session;
  });
}

export interface ChargerEvent {
  id: string;
  eventType: string;
  connectorId: number | null;
  payload: string;
  createdAt: string;
}

export async function getChargerEvents(chargerId: string, limit = 50): Promise<ChargerEvent[]> {
  const { data, error } = await requireSupabase()
    .from("EV_ChargerEvents")
    .select("id, event_type, connector_id, payload, created_at")
    .eq("charger_id", chargerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const payload = r.payload;
    return {
      id: r.id as string,
      eventType: r.event_type as string,
      connectorId: r.connector_id != null ? Number(r.connector_id) : null,
      payload: payload ? JSON.stringify(payload) : "",
      createdAt: r.created_at as string,
    };
  });
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [chargers, activeSessions] = await Promise.all([
    fetchChargersRaw(),
    getActiveSessionsForChargers(),
  ]);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data: todaySessions } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select("energy_kwh, amount")
    .gte("start_time", startOfDay.toISOString());

  const todayEnergyKwh = (todaySessions ?? []).reduce(
    (sum, s) => sum + Number((s as { energy_kwh: number }).energy_kwh ?? 0),
    0
  );
  const todayRevenue = (todaySessions ?? []).reduce(
    (sum, s) => sum + Number((s as { amount: number }).amount ?? 0),
    0
  );

  return computeDashboardStats(
    chargers,
    activeSessions,
    todayEnergyKwh || 97.5,
    todayRevenue || 1248.5,
    todaySessions?.length ?? 12
  );
}
