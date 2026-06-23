import type { Charger, ChargingSession, DashboardStats, TimeRange } from "@/types/ev";
import { resolveDashboardRange, utcRangeStart, type DashboardRange } from "@/utils/dateRanges";
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
    .select(
      `
      *,
      EV_ChargerConnectors(*),
      EV_Tariffs!tariff_id(id, name, rate_per_kwh, session_fee, gst_percent, applies_to, is_active, created_at)
    `
    )
    .order("name")
    .limit(limit);

  if (status !== "all") q = q.eq("status", status);
  else q = q.neq("status", "decommissioned");
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
    const tariffRow = raw.EV_Tariffs as Record<string, unknown> | Record<string, unknown>[] | null;
    const tariff = Array.isArray(tariffRow) ? tariffRow[0] : tariffRow;
    const { EV_ChargerConnectors: _removed, EV_Tariffs: _tariff, ...charger } = raw;
    return mapCharger(charger, connectors, tariff ?? null);
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
  tariffId?: string | null;
}

export interface ChargerUpdateInput {
  name: string;
  manufacturer: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  chargerType: "DC Fast" | "AC Slow";
  maxPowerKw: number;
  location: string;
  tariffId?: string | null;
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
      tariff_id: input.tariffId || null,
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

  const created = await getChargerById(chargerId);
  if (!created) throw new Error("Charger created but could not be loaded");
  return created;
}

export async function updateCharger(id: string, input: ChargerUpdateInput): Promise<Charger> {
  const existing = await getChargerById(id);
  if (!existing) {
    throw new Error("Charger not found");
  }

  const model = input.model?.trim() || defaultModel(input.manufacturer, input.chargerType);
  const serialNumber = input.serialNumber?.trim() || "";
  const firmwareVersion = input.firmwareVersion?.trim() || "v1.0.0";
  const typeChanged = existing.type !== input.chargerType;
  const powerChanged = existing.maxPowerKw !== input.maxPowerKw;

  if (typeChanged && existing.connectors.some((c) => c.status === "Charging")) {
    throw new Error("Cannot change charger type while a connector is charging");
  }

  const { data: chargerRow, error: chargerError } = await requireSupabase()
    .from("EV_Chargers")
    .update({
      name: input.name.trim(),
      manufacturer: input.manufacturer,
      model,
      serial_number: serialNumber || null,
      firmware_version: firmwareVersion,
      charger_type: input.chargerType,
      max_power_kw: input.maxPowerKw,
      location: input.location.trim(),
      tariff_id: input.tariffId || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (chargerError) throw chargerError;

  let connectorRows: Record<string, unknown>[] = existing.connectors.map((c) => ({
    id: c.id,
    charger_id: id,
    connector_id: c.connectorId,
    connector_type: c.type,
    max_power_kw: c.maxPowerKw,
    status: c.status,
  }));

  if (typeChanged) {
    const { error: deleteError } = await requireSupabase()
      .from("EV_ChargerConnectors")
      .delete()
      .eq("charger_id", id);
    if (deleteError) throw deleteError;

    const connectors = connectorPlan(input.chargerType, input.maxPowerKw).map((c) => ({
      charger_id: id,
      connector_id: c.connectorId,
      connector_type: c.connectorType,
      max_power_kw: c.maxPowerKw,
      status: "Unavailable",
    }));

    const { data: inserted, error: insertError } = await requireSupabase()
      .from("EV_ChargerConnectors")
      .insert(connectors)
      .select("*");

    if (insertError) throw insertError;
    connectorRows = (inserted ?? []) as Record<string, unknown>[];
  } else if (powerChanged) {
    const plan = connectorPlan(input.chargerType, input.maxPowerKw);
    for (const planned of plan) {
      const { error } = await requireSupabase()
        .from("EV_ChargerConnectors")
        .update({
          max_power_kw: planned.maxPowerKw,
          updated_at: new Date().toISOString(),
        })
        .eq("charger_id", id)
        .eq("connector_id", planned.connectorId);
      if (error) throw error;
    }

    const { data: refreshed, error: refreshError } = await requireSupabase()
      .from("EV_ChargerConnectors")
      .select("*")
      .eq("charger_id", id)
      .order("connector_id");

    if (refreshError) throw refreshError;
    connectorRows = (refreshed ?? []) as Record<string, unknown>[];
  }

  await requireSupabase().from("EV_ChargerEvents").insert({
    charger_id: id,
    event_type: "ChargerUpdated",
    payload: {
      chargePointId: existing.chargePointId,
      source: "admin",
      changes: {
        name: input.name,
        location: input.location,
        chargerType: input.chargerType,
        maxPowerKw: input.maxPowerKw,
        tariffId: input.tariffId ?? null,
      },
    },
  });

  const updated = await getChargerById(id);
  if (!updated) throw new Error("Charger not found after update");
  return updated;
}

export async function getChargerById(id: string): Promise<Charger | undefined> {
  const { data, error } = await requireSupabase()
    .from("EV_Chargers")
    .select(
      `
      *,
      EV_ChargerConnectors(*),
      EV_Tariffs!tariff_id(id, name, rate_per_kwh, session_fee, gst_percent, applies_to, is_active, created_at)
    `
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return undefined;
  const raw = data as Record<string, unknown>;
  const connectors = (raw.EV_ChargerConnectors as Record<string, unknown>[]) ?? [];
  const tariffRow = raw.EV_Tariffs as Record<string, unknown> | Record<string, unknown>[] | null;
  const tariff = Array.isArray(tariffRow) ? tariffRow[0] : tariffRow;
  const { EV_ChargerConnectors: _, EV_Tariffs: __, ...charger } = raw;
  return mapCharger(charger, connectors, tariff ?? null);
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

function getRangeBounds(range: DashboardRange | TimeRange) {
  if (typeof range === "string") {
    const days = range === "today" ? 1 : range === "week" ? 7 : range === "month" ? 30 : 90;
    const end = new Date();
    end.setUTCHours(23, 59, 59, 999);
    return { start: utcRangeStart(days), end, preset: range === "quarter" ? "month" as const : range };
  }
  return resolveDashboardRange(range);
}

function computePeakDemandKw(
  meterRows: { power_kw: number | null; sampled_at: string }[] | null,
  activeSessions: ChargingSession[]
): number {
  const demandByMinute = new Map<string, number>();

  for (const row of meterRows ?? []) {
    const power = Number(row.power_kw ?? 0);
    if (power <= 0) continue;
    const minuteKey = row.sampled_at.slice(0, 16);
    demandByMinute.set(minuteKey, (demandByMinute.get(minuteKey) ?? 0) + power);
  }

  let peak = 0;
  for (const demand of demandByMinute.values()) {
    peak = Math.max(peak, demand);
  }

  const activeDemand = activeSessions.reduce((sum, s) => sum + (s.currentPowerKw ?? 0), 0);
  return Math.max(peak, activeDemand);
}

export async function getDashboardStats(range: DashboardRange | TimeRange = "today"): Promise<DashboardStats> {
  const [chargers, activeSessions] = await Promise.all([
    fetchChargersRaw(),
    getActiveSessionsForChargers(),
  ]);

  const { start: rangeStart, end: rangeEnd } = getRangeBounds(range);
  const rangeStartIso = rangeStart.toISOString();
  const rangeEndIso = rangeEnd.toISOString();

  const [{ data: rangeSessions }, { data: meterRows }] = await Promise.all([
    requireSupabase()
      .from("EV_ChargingSessions")
      .select("energy_kwh, amount, start_time, end_time")
      .eq("status", "completed")
      .gte("start_time", rangeStartIso)
      .lte("start_time", rangeEndIso),
    requireSupabase()
      .from("EV_MeterValues")
      .select("power_kw, sampled_at")
      .gte("sampled_at", rangeStartIso)
      .lte("sampled_at", rangeEndIso)
      .not("power_kw", "is", null),
  ]);

  const rangeEnergyKwh = (rangeSessions ?? []).reduce(
    (sum, s) => sum + Number((s as { energy_kwh: number }).energy_kwh ?? 0),
    0
  );
  const rangeRevenue = (rangeSessions ?? []).reduce(
    (sum, s) => sum + Number((s as { amount: number }).amount ?? 0),
    0
  );

  let totalDurationMs = 0;
  let durationCount = 0;
  for (const session of rangeSessions ?? []) {
    const startTime = (session as { start_time: string }).start_time;
    const endTime = (session as { end_time: string | null }).end_time;
    if (!endTime) continue;
    const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
    if (durationMs <= 0) continue;
    totalDurationMs += durationMs;
    durationCount += 1;
  }

  const avgSessionDurationMs = durationCount > 0 ? totalDurationMs / durationCount : null;
  const peakPowerKw = computePeakDemandKw(
    (meterRows ?? []) as { power_kw: number | null; sampled_at: string }[],
    activeSessions as ChargingSession[]
  );

  return computeDashboardStats(
    chargers,
    activeSessions,
    rangeEnergyKwh,
    rangeRevenue,
    rangeSessions?.length ?? 0,
    avgSessionDurationMs,
    peakPowerKw
  );
}

export async function decommissionCharger(id: string): Promise<void> {
  const charger = await getChargerById(id);
  if (!charger) throw new Error("Charger not found");
  if (charger.status === "decommissioned") {
    throw new Error("Charger is already decommissioned");
  }

  const activeSessions = await getActiveSessionsForChargers();
  const hasActiveSession = activeSessions.some(
    (s) => s.chargePointId === charger.chargePointId || s.chargerId === id
  );
  if (hasActiveSession || charger.connectors.some((c) => c.status === "Charging")) {
    throw new Error("Cannot decommission while a charging session is active");
  }

  const { error: chargerError } = await requireSupabase()
    .from("EV_Chargers")
    .update({
      status: "decommissioned",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (chargerError) {
    throw new Error(
      chargerError.message.includes("policy")
        ? "Cannot decommission: run supabase/policies_write.sql on Supabase."
        : chargerError.message
    );
  }

  const { error: connectorError } = await requireSupabase()
    .from("EV_ChargerConnectors")
    .update({ status: "Unavailable", updated_at: new Date().toISOString() })
    .eq("charger_id", id);

  if (connectorError) throw connectorError;

  await requireSupabase().from("EV_ChargerEvents").insert({
    charger_id: id,
    event_type: "Decommissioned",
    payload: { chargePointId: charger.chargePointId, source: "admin" },
  });
}
