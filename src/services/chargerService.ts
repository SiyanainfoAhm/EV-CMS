import type { Charger, ChargingSession, DashboardStats, TimeRange } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { computeDashboardStats, mapCharger, mapSession } from "@/utils/supabaseMappers";

export interface ChargersQuery {
  status?: string; // online | offline | faulted | all
  type?: string; // DC Fast | AC Slow | all
  manufacturer?: string; // all or exact
  search?: string; // name/chargePointId/location
  limit?: number;
}

async function fetchChargersRaw(query: ChargersQuery = {}): Promise<Charger[]> {
  const { status = "all", type = "all", manufacturer = "all", search = "", limit = 500 } = query;

  let q = requireSupabase()
    .from("EV_Chargers")
    .select("*, EV_ChargerConnectors(*)")
    .order("name")
    .limit(limit);

  if (status !== "all") q = q.eq("status", status);
  if (type !== "all") q = q.eq("charger_type", type);
  if (manufacturer !== "all") q = q.eq("manufacturer", manufacturer);

  const s = search.trim();
  if (s) {
    q = q.or(`name.ilike.%${s}%,charge_point_id.ilike.%${s}%,location.ilike.%${s}%`);
  }

  const { data, error } = await q;

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

export async function getChargers(query: ChargersQuery = {}): Promise<Charger[]> {
  return fetchChargersRaw(query);
}

export interface ChargerInput {
  chargePointId: string;
  name: string;
  manufacturer: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  chargerType: "DC Fast" | "AC Slow";
  maxPowerKw: number;
  location: string;
}

function defaultModel(manufacturer: string, chargerType: string): string {
  if (manufacturer === "Tri Square") {
    return chargerType === "DC Fast" ? "TS-30DC-DG" : "TS-7.4AC-SG";
  }
  return chargerType === "DC Fast" ? "MP-30DC-DG" : "MP-7.5AC-SG";
}

function connectorPlan(chargerType: string, maxPowerKw: number): { connectorId: number; connectorType: string; maxPowerKw: number }[] {
  if (chargerType === "DC Fast") {
    const perGun = Math.round((maxPowerKw / 2) * 100) / 100;
    return [
      { connectorId: 1, connectorType: "CCS2", maxPowerKw: perGun },
      { connectorId: 2, connectorType: "CCS2", maxPowerKw: perGun },
    ];
  }
  return [{ connectorId: 1, connectorType: "Type2", maxPowerKw: maxPowerKw }];
}

export async function createCharger(input: ChargerInput): Promise<Charger> {
  const chargePointId = input.chargePointId.trim().toUpperCase();
  const model = input.model?.trim() || defaultModel(input.manufacturer, input.chargerType);
  const serialNumber = input.serialNumber?.trim() || "";
  const firmwareVersion = input.firmwareVersion?.trim() || "v1.0.0";

  const { data: chargerRow, error: chargerError } = await requireSupabase()
    .from("EV_Chargers")
    .insert({
      charge_point_id: chargePointId,
      name: input.name.trim(),
      manufacturer: input.manufacturer,
      model,
      serial_number: serialNumber || null,
      firmware_version: firmwareVersion,
      charger_type: input.chargerType,
      max_power_kw: input.maxPowerKw,
      status: "offline",
      location: input.location.trim(),
      is_simulated: false,
    })
    .select("*")
    .single();

  if (chargerError) {
    if (chargerError.code === "23505") {
      throw new Error(`Charge point ID "${chargePointId}" already exists`);
    }
    throw chargerError;
  }

  const chargerId = (chargerRow as { id: string }).id;
  const connectors = connectorPlan(input.chargerType, input.maxPowerKw).map((c) => ({
    charger_id: chargerId,
    connector_id: c.connectorId,
    connector_type: c.connectorType,
    max_power_kw: c.maxPowerKw,
    status: "Unavailable",
  }));

  const { data: connectorRows, error: connectorError } = await requireSupabase()
    .from("EV_ChargerConnectors")
    .insert(connectors)
    .select("*");

  if (connectorError) {
    throw connectorError;
  }

  await requireSupabase().from("EV_ChargerEvents").insert({
    charger_id: chargerId,
    event_type: "BootNotification",
    payload: { chargePointId, source: "admin", model, firmwareVersion },
  });

  return mapCharger(
    chargerRow as Record<string, unknown>,
    (connectorRows ?? []) as Record<string, unknown>[]
  );
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

function getRangeStart(timeRange: TimeRange): Date {
  const start = new Date();
  // Use UTC boundaries so server/DB UTC timestamps match the same day buckets.
  start.setUTCHours(0, 0, 0, 0);

  const days = timeRange === "today" ? 1 : timeRange === "week" ? 7 : timeRange === "month" ? 30 : 90;
  // Inclusive range: last `days` including today.
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

export async function getDashboardStats(timeRange: TimeRange = "today"): Promise<DashboardStats> {
  const [chargers, activeSessions] = await Promise.all([
    fetchChargersRaw(),
    getActiveSessionsForChargers(),
  ]);

  const rangeStart = getRangeStart(timeRange);

  const { data: rangeSessions } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select("energy_kwh, amount")
    .eq("status", "completed")
    .gte("start_time", rangeStart.toISOString());

  const rangeEnergyKwh = (rangeSessions ?? []).reduce(
    (sum, s) => sum + Number((s as { energy_kwh: number }).energy_kwh ?? 0),
    0
  );
  const rangeRevenue = (rangeSessions ?? []).reduce(
    (sum, s) => sum + Number((s as { amount: number }).amount ?? 0),
    0
  );

  return computeDashboardStats(
    chargers,
    activeSessions,
    rangeEnergyKwh,
    rangeRevenue,
    rangeSessions?.length ?? 0
  );
}
