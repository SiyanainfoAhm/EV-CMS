import { requireSupabase } from "../utils/supabaseClient";

function rpcError(error: { message: string }): never {
  throw new Error(error.message);
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

export async function simulateStopSession(sessionId: string): Promise<void> {
  const { error } = await requireSupabase().rpc("ev_sim_stop_session", { p_session_id: sessionId });
  if (error) rpcError(error);
}

export async function simulateMeterValue(sessionId: string): Promise<number> {
  const { data, error } = await requireSupabase().rpc("ev_sim_meter_value", { p_session_id: sessionId });
  if (error) rpcError(error);
  return Number(data ?? 0);
}
