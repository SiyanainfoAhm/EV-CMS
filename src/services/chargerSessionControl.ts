import { isSimulationEnabled } from "@/utils/simulationMode";
import { requireSupabase } from "@/utils/supabaseClient";
import * as ocppService from "@/services/ocppService";
import * as simulator from "@/services/chargerSimulatorService";
import { startSimulatorRuntime } from "@/services/simulatorRuntime";

export type SessionControlMode = "simulated" | "ocpp";

export async function resolveUserIdForIdTag(idTag: string): Promise<string | null> {
  const tag = idTag.trim();
  if (!tag || tag.toUpperCase() === "ADMIN-BYPASS") return null;
  const { data, error } = await requireSupabase()
    .from("EV_RFIDCards")
    .select("user_id")
    .ilike("uid", tag)
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
  // Physical / registered chargers → always real OCPP (never fake CMS session).
  if (params.ocppConnected) return false;
  if (params.isSimulated === false) return false;
  if (params.isSimulated === true) return isSimulationEnabled();
  return isSimulationEnabled();
}

export async function startChargingSession(params: {
  chargerId: string;
  chargePointId: string;
  connectorId: number;
  idTag?: string;
  userId?: string;
  bypassRfid?: boolean;
  useSimulation?: boolean;
  ocppConnected?: boolean;
  isSimulated?: boolean;
}): Promise<{ success: boolean; message: string; mode: SessionControlMode }> {
  const idTag = (params.idTag ?? "").trim();
  if (!idTag || idTag.toUpperCase() === "ADMIN-BYPASS") {
    return {
      success: false,
      message:
        "Web admin Start requires a valid RFID UID or MOBILE-{userId}. Admin Bypass is removed — use mobile prepaid or an assigned RFID card.",
      mode: "ocpp",
    };
  }

  if (
    useSimulatedSessions({
      useSimulation: params.useSimulation,
      ocppConnected: params.ocppConnected,
      isSimulated: params.isSimulated,
    })
  ) {
    const userId =
      params.userId?.trim() || (await resolveUserIdForIdTag(idTag));
    if (!userId) {
      return {
        success: false,
        message: "RFID card is not assigned to any user.",
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
    idTag,
    bypassRfid: false,
    ...(params.userId?.trim() ? { userId: params.userId.trim() } : {}),
  });
  return {
    success: result.accepted,
    message: result.accepted
      ? `RemoteStart accepted on Gun ${params.connectorId}. Waiting for StartTransaction → Charging…`
      : `RemoteStart rejected by charger on Gun ${params.connectorId}`,
    mode: "ocpp",
  };
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
    bypassRfid: false,
  });
  return {
    success: result.accepted,
    message: result.accepted
      ? `RemoteStop sent for transaction ${params.transactionId}`
      : `RemoteStop rejected by charger`,
    mode: "ocpp",
  };
}
