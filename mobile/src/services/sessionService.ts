import { requireSupabase } from "../utils/supabaseClient";
import type { ChargingSession } from "../types";

const select = `
  *,
  EV_Chargers ( name, charge_point_id ),
  EV_Users ( full_name )
`;

function mapRow(row: Record<string, unknown>): ChargingSession {
  const charger = row.EV_Chargers as Record<string, unknown> | null;
  const user = row.EV_Users as Record<string, unknown> | null;
  const start = row.start_time as string;
  return {
    id: row.id as string,
    chargerName: (charger?.name as string) ?? "",
    chargePointId: (charger?.charge_point_id as string) ?? "",
    connectorId: row.connector_id as number,
    energyKwh: Number(row.energy_kwh ?? 0),
    duration: "—",
    status: row.status as string,
    startTime: start,
    currentPowerKw: row.current_power_kw != null ? Number(row.current_power_kw) : undefined,
    soc: row.soc != null ? Number(row.soc) : undefined,
    amount: row.amount != null ? Number(row.amount) : undefined,
  };
}

export async function getActiveSession(): Promise<ChargingSession | null> {
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select(select)
    .eq("status", "active")
    .order("start_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function getSessionHistory(): Promise<ChargingSession[]> {
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select(select)
    .eq("status", "completed")
    .order("start_time", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export async function startSession(chargerId: string, connectorId: number): Promise<ChargingSession> {
  const active = await getActiveSession();
  if (active) return active;
  const { data } = await requireSupabase().from("EV_Chargers").select("*").eq("id", chargerId).single();
  return {
    id: "pending",
    chargerName: (data?.name as string) ?? "",
    chargePointId: (data?.charge_point_id as string) ?? "",
    connectorId,
    energyKwh: 0,
    duration: "0m",
    status: "active",
    startTime: new Date().toISOString(),
  };
}

export async function stopSession(_sessionId: string): Promise<void> {
  // TODO: OCPP gateway + update "EV_ChargingSessions"
}
