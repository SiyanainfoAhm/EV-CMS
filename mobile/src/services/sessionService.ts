import { requireSupabase } from "../utils/supabaseClient";
import { formatSessionDuration } from "../utils/format";
import { requireUserId } from "./authService";
import * as simulator from "./chargerSimulatorService";
import * as ocppService from "./ocppService";
import * as rfidService from "./rfidService";
import { assertChargerOnlineForMobile, isConnectorAvailable } from "./chargerService";
import { isSimulationEnabled } from "../utils/simulationMode";
import type { ChargingSession } from "../types";

const select = `
  *,
  EV_Chargers ( name, charge_point_id, is_simulated ),
  EV_Users ( full_name )
`;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Wait for OCPP StartTransaction to create the user's active session. */
async function pollActiveSession(
  userId: string,
  chargerId: string,
  attempts = 25
): Promise<ChargingSession | null> {
  for (let i = 0; i < attempts; i++) {
    const session = await getActiveSession(userId);
    if (session && session.chargerId === chargerId) return session;
    await sleep(1000);
  }
  return null;
}

async function pollSessionStopped(sessionId: string, userId: string, attempts = 15): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const session = await getSessionById(sessionId, userId);
    if (!session || session.status !== "active") return true;
    await sleep(1000);
  }
  return false;
}

/**
 * Mobile OCPP start must use a real RFID bound to this user.
 * Web lab bypass uses ADMIN-BYPASS and attributes the session to a fallback user —
 * that breaks mobile Live Session / payment ownership.
 */
async function resolveMobileIdTag(userId: string): Promise<string> {
  const cards = await rfidService.getUserRfidCards(userId);
  const active = cards.find((c) => String(c.status).toLowerCase() === "active");
  if (active?.uid?.trim()) return active.uid.trim();
  throw new Error(
    "Bind an active RFID card in the app before starting a charge on this charger."
  );
}

function mapRow(row: Record<string, unknown>): ChargingSession {
  const charger = row.EV_Chargers as Record<string, unknown> | null;
  const start = row.start_time as string;
  const end = row.end_time as string | null;
  const prepaidModeRaw = row.prepaid_mode != null ? String(row.prepaid_mode) : null;
  const prepaidTypeRaw =
    row.prepaid_type != null ? String(row.prepaid_type) : prepaidModeRaw;
  const paymentMode =
    row.payment_mode != null
      ? String(row.payment_mode)
      : prepaidModeRaw
        ? "prepaid"
        : null;

  return {
    id: row.id as string,
    chargerId: (row.charger_id as string) ?? undefined,
    chargerName: (charger?.name as string) ?? "",
    chargePointId: (charger?.charge_point_id as string) ?? "",
    connectorId: row.connector_id as number,
    transactionId: row.transaction_id != null ? Number(row.transaction_id) : null,
    energyKwh: Number(row.energy_kwh ?? 0),
    duration: formatSessionDuration(start, end),
    status: row.status as string,
    startTime: start,
    endTime: end ?? undefined,
    currentPowerKw: row.current_power_kw != null ? Number(row.current_power_kw) : undefined,
    soc: row.soc != null ? Number(row.soc) : undefined,
    amount: row.amount != null ? Number(row.amount) : undefined,
    paymentMode,
    prepaidType: prepaidTypeRaw,
    prepaidMode:
      prepaidModeRaw === "amount" || prepaidModeRaw === "time"
        ? prepaidModeRaw
        : prepaidTypeRaw === "amount" || prepaidTypeRaw === "time"
          ? prepaidTypeRaw
          : null,
    paymentStatus: row.payment_status != null ? String(row.payment_status) : null,
    paymentId:
      row.payment_id != null
        ? String(row.payment_id)
        : row.prepaid_payment_id != null
          ? String(row.prepaid_payment_id)
          : null,
    prepaidAmount:
      row.prepaid_amount != null
        ? Number(row.prepaid_amount)
        : row.prepaid_total_inr != null
          ? Number(row.prepaid_total_inr)
          : null,
    prepaidTotalInr: row.prepaid_total_inr != null ? Number(row.prepaid_total_inr) : null,
    prepaidDurationMinutes:
      row.prepaid_duration_minutes != null
        ? Number(row.prepaid_duration_minutes)
        : prepaidModeRaw === "time" && row.prepaid_value != null
          ? Number(row.prepaid_value)
          : null,
    amountDue: row.amount_due != null ? Number(row.amount_due) : null,
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

export type StartSessionOptions = {
  prepaidPaid?: boolean;
  paymentId?: string;
};

/**
 * Start charging — same OCPP RemoteStart path as web for real chargers.
 * Simulated chargers use CMS RPC only when simulation mode is enabled.
 */
export async function startSession(
  chargerId: string,
  connectorId: number,
  userId?: string,
  options: StartSessionOptions = {}
): Promise<ChargingSession> {
  const uid = userId ?? requireUserId();

  const existing = await getActiveSession(uid);
  if (existing) return existing;

  await assertChargerOnlineForMobile(chargerId);

  const { data: charger, error: chargerErr } = await requireSupabase()
    .from("EV_Chargers")
    .select("*, EV_ChargerConnectors(*)")
    .eq("id", chargerId)
    .single();

  if (chargerErr || !charger) {
    throw new Error(chargerErr?.message ?? "Charger not found");
  }

  const status = String((charger as { status?: string }).status || "")
    .toLowerCase()
    .trim();
  if (status !== "online" && status !== "available") {
    throw new Error("Cannot start charging because this charger is not online.");
  }

  const connectors = (charger.EV_ChargerConnectors as Record<string, unknown>[]) ?? [];
  const connector = connectors.find((c) => Number(c.connector_id) === Number(connectorId));
  if (!connector) {
    throw new Error(`Connector ${connectorId} not found on this charger`);
  }
  const connStatus = String(connector.status ?? "");
  if (!isConnectorAvailable(connStatus)) {
    throw new Error(`Connector is not available (status: ${connStatus || "unknown"})`);
  }

  const { data: busyRow } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select("id")
    .eq("charger_id", chargerId)
    .eq("connector_id", connectorId)
    .eq("status", "active")
    .maybeSingle();
  if (busyRow) {
    throw new Error("Connector already has an active session");
  }

  const isSimulated = Boolean((charger as { is_simulated?: boolean }).is_simulated);
  const chargePointId = String((charger as { charge_point_id?: string }).charge_point_id || "");

  if (isSimulated) {
    if (!isSimulationEnabled()) {
      throw new Error("Simulation is disabled. Use a real online charger.");
    }
    const sessionId = await simulator.simulateStartSession(chargerId, connectorId, uid);
    const session = await getSessionById(sessionId, uid);
    if (!session) throw new Error("Session started but could not be loaded");
    return session;
  }

  // Real charger — same gateway RemoteStart as web CMS.
  if (!ocppService.isOcppGatewayConfigured()) {
    throw new Error(
      "OCPP gateway is not configured. Set EXPO_PUBLIC_OCPP_GATEWAY_API_URL (same as web VITE_OCPP_GATEWAY_API_URL)."
    );
  }

  const idTag = await resolveMobileIdTag(uid);
  const result = await ocppService.remoteStartTransaction({
    chargePointId,
    connectorId,
    idTag,
    bypassRfid: false,
    prepaidPaid: options.prepaidPaid,
    paymentId: options.paymentId,
  });
  if (!result.accepted) {
    throw new Error(`RemoteStart rejected by charger on Gun ${connectorId}`);
  }

  const session = await pollActiveSession(uid, chargerId);
  if (!session) {
    throw new Error(
      "RemoteStart accepted but session did not start. Plug in the cable (Preparing) and try again."
    );
  }
  return session;
}

/**
 * Stop charging — same OCPP RemoteStop path as web for real sessions.
 */
export async function stopSession(sessionId: string, userId?: string): Promise<void> {
  const uid = userId ?? requireUserId();
  const session = await getSessionById(sessionId, uid);
  if (!session) throw new Error("Session not found");
  if (session.status !== "active") return;

  const chargePointId = session.chargePointId;
  const transactionId = session.transactionId;

  const { data: chargerRow } = await requireSupabase()
    .from("EV_Chargers")
    .select("is_simulated")
    .eq("id", session.chargerId ?? "")
    .maybeSingle();
  const isSimulated = Boolean((chargerRow as { is_simulated?: boolean } | null)?.is_simulated);

  if (isSimulated || isSimulationEnabled()) {
    await simulator.simulateStopSession(sessionId);
    return;
  }

  if (!ocppService.isOcppGatewayConfigured()) {
    throw new Error(
      "OCPP gateway is not configured. Cannot stop the charger. Set EXPO_PUBLIC_OCPP_GATEWAY_API_URL."
    );
  }

  if (!chargePointId || transactionId == null) {
    throw new Error("Session is missing charge point or transaction id for RemoteStop");
  }

  const result = await ocppService.remoteStopTransaction({
    chargePointId,
    transactionId: Number(transactionId),
  });
  if (!result.accepted) {
    throw new Error("RemoteStop rejected by charger");
  }

  const stopped = await pollSessionStopped(sessionId, uid);
  if (!stopped) {
    // Charger accepted stop but CMS row still active — force CMS close as last resort.
    await simulator.simulateStopSession(sessionId);
  }
}
