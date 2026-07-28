import { isSimulationEnabled } from "@/utils/simulationMode";
import { requireSupabase } from "@/utils/supabaseClient";
import * as ocppService from "@/services/ocppService";
import * as simulator from "@/services/chargerSimulatorService";
import * as rfidService from "@/services/rfidService";
import { startSimulatorRuntime } from "@/services/simulatorRuntime";

export type SessionControlMode = "simulated" | "ocpp";

/** OCPP idTag for web admin RemoteStart (RFID bypass at charger). */
export const ADMIN_BYPASS_ID_TAG = "ADMIN-BYPASS";

/** OCPP idTag for mobile app starts. */
export function buildMobileIdTag(userId: string): string {
  const uid = userId.trim();
  if (!uid) {
    throw new Error("User session not found. Please login again.");
  }
  return `MOBILE-${uid}`;
}

export async function resolveUserIdForIdTag(idTag: string): Promise<string | null> {
  const tag = idTag.trim();
  if (!tag || tag.toUpperCase() === "ADMIN-BYPASS") return null;
  if (tag.toUpperCase().startsWith("MOBILE-")) {
    const userId = tag.slice("MOBILE-".length).trim();
    return userId || null;
  }
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
  const userId = params.userId?.trim() || null;
  let idTag = (params.idTag ?? "").trim();
  if (!idTag && userId) {
    idTag = buildMobileIdTag(userId);
  }
  if (!idTag) {
    return {
      success: false,
      message: "Start requires a logged-in user or valid RFID.",
      mode: "ocpp",
    };
  }

  const useBypass = Boolean(params.bypassRfid) && idTag.toUpperCase() === ADMIN_BYPASS_ID_TAG;

  if (
    useSimulatedSessions({
      useSimulation: params.useSimulation,
      ocppConnected: params.ocppConnected,
      isSimulated: params.isSimulated,
    })
  ) {
    const resolvedUserId = userId || (await resolveUserIdForIdTag(idTag));
    if (!resolvedUserId) {
      return {
        success: false,
        message: userId
          ? "User session not found. Please login again."
          : "RFID card is not assigned to any user.",
        mode: "simulated",
      };
    }
    startSimulatorRuntime();
    const sessionId = await simulator.simulateStartSession(
      params.chargerId,
      params.connectorId,
      resolvedUserId,
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
    idTag: useBypass ? ADMIN_BYPASS_ID_TAG : idTag,
    bypassRfid: useBypass,
    ...(userId ? { userId } : {}),
  });
  return {
    success: result.accepted,
    message: result.accepted
      ? `RemoteStart accepted on Gun ${params.connectorId}. Waiting for StartTransaction → Charging…`
      : `RemoteStart rejected by charger on Gun ${params.connectorId}`,
    mode: "ocpp",
  };
}

/** Web admin RemoteStart — OCPP ADMIN-BYPASS idTag; session attributed to logged-in admin. */
export async function startAdminChargingSession(params: {
  chargerId: string;
  chargePointId: string;
  connectorId: number;
  adminUserId: string;
  ocppConnected?: boolean;
  isSimulated?: boolean;
}): Promise<{ success: boolean; message: string; mode: SessionControlMode }> {
  const adminUserId = params.adminUserId.trim();
  if (!adminUserId) {
    return {
      success: false,
      message: "User session not found. Please login again.",
      mode: "ocpp",
    };
  }

  if (
    !useSimulatedSessions({
      ocppConnected: params.ocppConnected,
      isSimulated: params.isSimulated,
    })
  ) {
    await rfidService.ensureAdminBypassAuthorizeTag(adminUserId);
  }

  return startChargingSession({
    chargerId: params.chargerId,
    chargePointId: params.chargePointId,
    connectorId: params.connectorId,
    userId: adminUserId,
    idTag: ADMIN_BYPASS_ID_TAG,
    bypassRfid: true,
    ocppConnected: params.ocppConnected,
    isSimulated: params.isSimulated,
  });
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
    bypassRfid: params.bypassRfid !== false,
  });
  return {
    success: result.accepted,
    message: result.accepted
      ? `RemoteStop sent for transaction ${params.transactionId}`
      : `RemoteStop rejected by charger`,
    mode: "ocpp",
  };
}
