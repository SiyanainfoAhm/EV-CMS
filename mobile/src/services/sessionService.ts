import { requireSupabase } from "../utils/supabaseClient";
import { formatSessionDuration } from "../utils/format";
import { requireUserId } from "./authService";
import * as simulator from "./chargerSimulatorService";
import type { ChargingSession } from "../types";

const select = `
  *,
  EV_Chargers ( name, charge_point_id ),
  EV_Users ( full_name )
`;

function mapRow(row: Record<string, unknown>): ChargingSession {
  const charger = row.EV_Chargers as Record<string, unknown> | null;
  const start = row.start_time as string;
  const end = row.end_time as string | null;
  return {
    id: row.id as string,
    chargerName: (charger?.name as string) ?? "",
    chargePointId: (charger?.charge_point_id as string) ?? "",
    connectorId: row.connector_id as number,
    energyKwh: Number(row.energy_kwh ?? 0),
    duration: formatSessionDuration(start, end),
    status: row.status as string,
    startTime: start,
    endTime: end ?? undefined,
    currentPowerKw: row.current_power_kw != null ? Number(row.current_power_kw) : undefined,
    soc: row.soc != null ? Number(row.soc) : undefined,
    amount: row.amount != null ? Number(row.amount) : undefined,
  };
}

export async function getActiveSession(userId?: string): Promise<ChargingSession | null> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select(select)
    .eq("user_id", uid)
    .eq("status", "active")
    .order("start_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function getSessionHistory(
  userId?: string,
  limit = 50
): Promise<ChargingSession[]> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select(select)
    .eq("user_id", uid)
    .neq("status", "active")
    .order("start_time", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export async function getRecentSessions(userId?: string, limit = 5): Promise<ChargingSession[]> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select(select)
    .eq("user_id", uid)
    .order("start_time", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export async function getSessionById(sessionId: string, userId?: string): Promise<ChargingSession | null> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select(select)
    .eq("id", sessionId)
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function startSession(
  chargerId: string,
  connectorId: number,
  userId?: string
): Promise<ChargingSession> {
  const uid = userId ?? requireUserId();

  const existing = await getActiveSession(uid);
  if (existing) return existing;

  const { data: charger, error: chargerErr } = await requireSupabase()
    .from("EV_Chargers")
    .select("*, EV_ChargerConnectors(*)")
    .eq("id", chargerId)
    .single();

  if (chargerErr || !charger) {
    throw new Error(chargerErr?.message ?? "Charger not found");
  }

  const connectors = (charger.EV_ChargerConnectors as Record<string, unknown>[]) ?? [];
  const connector = connectors.find((c) => c.connector_id === connectorId);
  if (!connector) {
    throw new Error(`Connector ${connectorId} not found on this charger`);
  }
  const connStatus = String(connector.status ?? "");
  if (connStatus.toLowerCase() !== "available") {
    throw new Error(`Connector is not available (status: ${connStatus})`);
  }

  const sessionId = await simulator.simulateStartSession(chargerId, connectorId, uid);
  const session = await getSessionById(sessionId, uid);
  if (!session) throw new Error("Session started but could not be loaded");
  return session;
}

export async function stopSession(sessionId: string, userId?: string): Promise<void> {
  const uid = userId ?? requireUserId();
  const session = await getSessionById(sessionId, uid);
  if (!session) throw new Error("Session not found");

  await simulator.simulateStopSession(sessionId);
}
