import { requireSupabase } from "@/utils/supabaseClient";

function rpcError(error: { message: string }): never {
  throw new Error(error.message);
}

export async function createDemoChargers(): Promise<number> {
  const { data, error } = await requireSupabase().rpc("ev_sim_create_demo_chargers");
  if (error) rpcError(error);
  return Number(data ?? 0);
}

export async function simulateHeartbeat(chargerId: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc("ev_sim_heartbeat", { p_charger_id: chargerId });
  if (error) rpcError(error);
  return data as string;
}

export async function simulateHeartbeatAll(): Promise<number> {
  const { data, error } = await requireSupabase().rpc("ev_sim_heartbeat_all");
  if (error) rpcError(error);
  return Number(data ?? 0);
}

export type SimulatedChargerStatus =
  | "Available"
  | "Charging"
  | "Preparing"
  | "Finishing"
  | "Faulted"
  | "Unavailable"
  | "Offline";

export async function simulateStatusChange(chargerId: string, status: SimulatedChargerStatus): Promise<void> {
  const { error } = await requireSupabase().rpc("ev_sim_status_change", {
    p_charger_id: chargerId,
    p_status: status,
  });
  if (error) rpcError(error);
}

export async function simulateStartSession(
  chargerId: string,
  connectorId: number,
  userId: string
): Promise<string> {
  const { data, error } = await requireSupabase().rpc("ev_sim_start_session", {
    p_charger_id: chargerId,
    p_connector_id: connectorId,
    p_user_id: userId,
  });
  if (error) rpcError(error);
  return data as string;
}

export async function simulateMeterValue(sessionId: string): Promise<number> {
  const { data, error } = await requireSupabase().rpc("ev_sim_meter_value", { p_session_id: sessionId });
  if (error) rpcError(error);
  return Number(data ?? 0);
}

export async function simulateMeterAllActive(): Promise<number> {
  const { data, error } = await requireSupabase().rpc("ev_sim_meter_all_active");
  if (error) rpcError(error);
  return Number(data ?? 0);
}

export async function simulateStopSession(sessionId: string): Promise<void> {
  const { error } = await requireSupabase().rpc("ev_sim_stop_session", { p_session_id: sessionId });
  if (error) rpcError(error);
}

export interface SimulatorChargerRow {
  id: string;
  chargePointId: string;
  name: string;
  status: string;
  lastHeartbeat: string | null;
  isSimulated: boolean;
  activeSessionId: string | null;
  activeConnectorId: number | null;
}

export async function listSimulatorChargers(): Promise<SimulatorChargerRow[]> {
  const supabase = requireSupabase();
  const { data: chargers, error } = await supabase
    .from("EV_Chargers")
    .select("id, charge_point_id, name, status, last_heartbeat_at, is_simulated")
    .order("charge_point_id");
  if (error) rpcError(error);

  const { data: sessions } = await supabase
    .from("EV_ChargingSessions")
    .select("id, charger_id, connector_id")
    .eq("status", "active");

  const activeByCharger = new Map<string, { id: string; connectorId: number }>();
  for (const s of sessions ?? []) {
    const row = s as { id: string; charger_id: string; connector_id: number };
    activeByCharger.set(row.charger_id, { id: row.id, connectorId: row.connector_id });
  }

  return (chargers ?? []).map((c) => {
    const r = c as Record<string, unknown>;
    const active = activeByCharger.get(r.id as string);
    return {
      id: r.id as string,
      chargePointId: r.charge_point_id as string,
      name: r.name as string,
      status: r.status as string,
      lastHeartbeat: (r.last_heartbeat_at as string) ?? null,
      isSimulated: Boolean(r.is_simulated),
      activeSessionId: active?.id ?? null,
      activeConnectorId: active?.connectorId ?? null,
    };
  });
}
