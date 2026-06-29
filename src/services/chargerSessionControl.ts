import { isSimulationEnabled } from "@/utils/simulationMode";
import { requireSupabase } from "@/utils/supabaseClient";
import * as ocppService from "@/services/ocppService";
import * as simulator from "@/services/chargerSimulatorService";
import { startSimulatorRuntime } from "@/services/simulatorRuntime";

export type SessionControlMode = "simulated" | "ocpp";

export async function resolveUserIdForIdTag(idTag: string): Promise<string | null> {
  const { data, error } = await requireSupabase()
    .from("EV_RFIDCards")
    .select("user_id")
    .eq("uid", idTag.trim())
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  const row = data as { user_id: string | null } | null;
  return row?.user_id ?? null;
}

function useSimulatedSessions(params: {
  useSimulation?: boolean;
  ocppConnected?: boolean;
  isSimulated?: boolean;
}): boolean {
  if (params.useSimulation === true) return true;
  if (params.useSimulation === false) return false;
  // Physical charger on WebSocket → always real OCPP (never fake CMS session).
  if (params.ocppConnected) return false;
  if (params.isSimulated) return isSimulationEnabled();
  return isSimulationEnabled();
}

export async function startChargingSession(params: {
  chargerId: string;
  chargePointId: string;
  connectorId: number;
  idTag?: string;
  bypassRfid?: boolean;
  useSimulation?: boolean;
  ocppConnected?: boolean;
  isSimulated?: boolean;
}): Promise<{ success: boolean; message: string; mode: SessionControlMode }> {
  const bypassRfid = params.bypassRfid !== false;
  if (
    useSimulatedSessions({
      useSimulation: params.useSimulation,
      ocppConnected: params.ocppConnected,
      isSimulated: params.isSimulated,
    })
  ) {
    const userId = bypassRfid
      ? (await resolveUserIdForIdTag(params.idTag ?? "")) ?? (await resolveFallbackUserId())
      : await resolveUserIdForIdTag(params.idTag ?? "");
    if (!userId) {
      return {
        success: false,
        message: `No active user bound to RFID ${(params.idTag ?? "").trim() || "(none)"}`,
        mode: "simulated",
      };
    }
    startSimulatorRuntime();
    const sessionId = await simulator.simulateStartSession(
      params.chargerId,
      params.connectorId,
      userId,
    );
    await simulator.simulateMeterValue(sessionId);
    return {
      success: true,
      message: `Charging started on Gun ${params.connectorId} (CMS simulation — energy updates in admin)`,
      mode: "simulated",
    };
  }

  const result = await ocppService.remoteStartTransaction({
    chargePointId: params.chargePointId,
    connectorId: params.connectorId,
    bypassRfid,
    ...(params.idTag?.trim() ? { idTag: params.idTag.trim() } : {}),
  });
  return {
    success: result.accepted,
    message: result.accepted
      ? `RemoteStart accepted on Gun ${params.connectorId} (admin RFID bypass). Waiting for StartTransaction → Charging…`
      : `RemoteStart rejected by charger on Gun ${params.connectorId}`,
    mode: "ocpp",
  };
}

async function resolveFallbackUserId(): Promise<string | null> {
  const { data, error } = await requireSupabase()
    .from("EV_Users")
    .select("id")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

export async function stopChargingSession(params: {
  chargePointId: string;
  transactionId: number;
  sessionId: string;
  bypassRfid?: boolean;
  useSimulation?: boolean;
  ocppConnected?: boolean;
  isSimulated?: boolean;
}): Promise<{ success: boolean; message: string; mode: SessionControlMode }> {
  const bypassRfid = params.bypassRfid !== false;
  if (
    useSimulatedSessions({
      useSimulation: params.useSimulation,
      ocppConnected: params.ocppConnected,
      isSimulated: params.isSimulated,
    })
  ) {
    await simulator.simulateStopSession(params.sessionId);
    return {
      success: true,
      message: `Charging stopped on Gun (CMS simulation)`,
      mode: "simulated",
    };
  }

  const result = await ocppService.remoteStopTransaction({
    chargePointId: params.chargePointId,
    transactionId: params.transactionId,
    bypassRfid,
  });
  return {
    success: result.accepted,
    message: result.accepted
      ? `RemoteStop sent for transaction ${params.transactionId}`
      : `RemoteStop rejected by charger`,
    mode: "ocpp",
  };
}
