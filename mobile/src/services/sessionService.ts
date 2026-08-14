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
  EV_Chargers ( * ),
  EV_Users ( full_name )
`;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Wait for OCPP StartTransaction to create the user's active session. */
async function pollActiveSession(
  userId: string,
  chargerId: string,
  connectorId: number,
  attempts = 90
): Promise<ChargingSession | null> {
  for (let i = 0; i < attempts; i++) {
    const mine = await getActiveSession(userId);
    if (mine && mine.chargerId === chargerId && Number(mine.connectorId) === Number(connectorId)) {
      return mine;
    }
    const claimed = await claimConnectorSession(userId, chargerId, connectorId);
    if (claimed) return claimed;
    await sleep(1000);
  }
  return null;
}

/** If StartTransaction briefly created then stopped (auth fail), surface that. */
async function findRecentEndedSession(
  chargerId: string,
  connectorId: number
): Promise<{ id: string; status: string; energyKwh: number } | null> {
  const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select("id, status, energy_kwh, start_time, end_time")
    .eq("charger_id", chargerId)
    .eq("connector_id", connectorId)
    .in("status", ["completed", "cancelled", "stopped", "faulted"])
    .gte("start_time", since)
    .order("start_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; status: string; energy_kwh?: number };
  return {
    id: row.id,
    status: row.status,
    energyKwh: Number(row.energy_kwh ?? 0),
  };
}

async function readConnectorStatus(
  chargerId: string,
  connectorId: number
): Promise<string> {
  const { data } = await requireSupabase()
    .from("EV_ChargerConnectors")
    .select("status")
    .eq("charger_id", chargerId)
    .eq("connector_id", connectorId)
    .maybeSingle();
  return String((data as { status?: string } | null)?.status ?? "");
}

/**
 * Many DC chargers only StartTransaction after the cable is plugged (Preparing).
 * Wait briefly so RemoteStart is more likely to produce a live session.
 */
async function waitForCablePreparing(
  chargerId: string,
  connectorId: number,
  maxWaitMs = 30_000
): Promise<string> {
  let status = await readConnectorStatus(chargerId, connectorId);
  const initial = status.toLowerCase();
  if (initial === "preparing" || initial === "charging") {
    return status;
  }
  // Already Available — short wait for cable plug before RemoteStart.
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(1500);
    status = await readConnectorStatus(chargerId, connectorId);
    const s = status.toLowerCase();
    if (s === "preparing" || s === "charging") return status;
    if (s === "faulted" || s === "unavailable") {
      throw new Error(`Gun ${connectorId} became ${status}. Unplug and try again.`);
    }
  }
  return status;
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
 * Mobile start auth — never use ADMIN-BYPASS.
 * idTag = MOBILE-{userId}; OCPP Authorize resolves via EV_RFIDCards.
 */
async function resolveMobileStartAuth(userId: string): Promise<{
  idTag: string;
  bypassRfid: boolean;
}> {
  if (!userId?.trim()) {
    throw new Error("User session not found. Please login again.");
  }
  const idTag = await rfidService.ensureMobileAuthorizeTag(userId);
  console.log("[auth] mobile user_id", userId);
  console.log("[session] auth_method", "Mobile");
  console.log("[session] started_by", "mobile");
  console.log("[session] user_id", userId);
  console.log("[session] id_tag", idTag);
  return { idTag, bypassRfid: false };
}

async function claimConnectorSession(
  userId: string,
  chargerId: string,
  connectorId: number
): Promise<ChargingSession | null> {
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select("id, user_id")
    .eq("charger_id", chargerId)
    .eq("connector_id", connectorId)
    .eq("status", "active")
    .gte("start_time", since)
    .order("start_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as { id: string; user_id: string };
  if (row.user_id !== userId) {
    const { error: updErr } = await requireSupabase()
      .from("EV_ChargingSessions")
      .update({
        user_id: userId,
        authorization_method: "Mobile",
        started_by: "mobile",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "active");
    if (updErr) {
      // Retry without optional columns if missing.
      const { error: updErr2 } = await requireSupabase()
        .from("EV_ChargingSessions")
        .update({
          user_id: userId,
          authorization_method: "Mobile",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "active");
      if (updErr2) {
        const { error: updErr3 } = await requireSupabase()
          .from("EV_ChargingSessions")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("status", "active");
        if (updErr3) throw updErr3;
      }
    }
  }
  return getSessionById(row.id, userId);
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
    chargerName:
      (charger?.display_name as string)?.trim() ||
      (charger?.name as string) ||
      "",
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
    prepaidEnergyCapKwh:
      row.prepaid_energy_cap_kwh != null ? Number(row.prepaid_energy_cap_kwh) : null,
    prepaidExpiresAt: row.prepaid_expires_at != null ? String(row.prepaid_expires_at) : null,
    amountDue: row.amount_due != null ? Number(row.amount_due) : null,
    authMethod: row.authorization_method != null ? String(row.authorization_method) : null,
    ratePerKwhSnapshot:
      row.rate_per_kwh_snapshot != null ? Number(row.rate_per_kwh_snapshot) : null,
    sessionFeeSnapshot:
      row.session_fee_snapshot != null ? Number(row.session_fee_snapshot) : null,
    gstPercentSnapshot:
      row.gst_percent_snapshot != null ? Number(row.gst_percent_snapshot) : null,
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
  if (!uid?.trim()) {
    throw new Error("User session not found. Please login again.");
  }
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select(select)
    .eq("user_id", uid)
    .order("start_time", { ascending: false })
    .limit(Math.max(limit * 3, 15));

  if (error) throw error;
  return (data ?? [])
    .map((row) => mapRow(row as Record<string, unknown>))
    .filter((s) => {
      const auth = String(s.authMethod ?? "").toLowerCase();
      if (auth.includes("admin") || auth.includes("bypass")) return false;
      return true;
    })
    .slice(0, limit);
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
  if (!uid?.trim()) {
    throw new Error("User session not found. Please login again.");
  }

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

  // Real charger — OCPP RemoteStart with MOBILE-{userId} idTag (never ADMIN-BYPASS).
  if (!ocppService.isOcppGatewayConfigured()) {
    throw new Error(
      "OCPP gateway is not configured. Set EXPO_PUBLIC_OCPP_GATEWAY_API_URL (same as web VITE_OCPP_GATEWAY_API_URL)."
    );
  }

  // Prefer cable plugged (Preparing) before RemoteStart — otherwise CP accepts
  // then never StartTransaction, or auth-fails within seconds.
  const preStatus = await waitForCablePreparing(chargerId, connectorId, 30_000);
  const preLower = String(preStatus).toLowerCase();
  if (preLower !== "preparing" && preLower !== "charging") {
    throw new Error(
      `Gun ${connectorId} is still ${preStatus || "Available"}. Plug in the cable, wait for Preparing, then try again.`
    );
  }

  const { idTag, bypassRfid } = await resolveMobileStartAuth(uid);
  console.log("[ocpp] RemoteStart idTag", idTag);

  const result = await ocppService.remoteStartTransaction({
    chargePointId,
    connectorId,
    idTag,
    bypassRfid,
    userId: uid,
    prepaidPaid: true,
    paymentId: options.paymentId,
  });
  if (!result.accepted) {
    throw new Error(
      `RemoteStart rejected by charger on Gun ${connectorId}. Ensure the cable is plugged (Preparing) and try again.`
    );
  }

  // Poll + claim for up to ~90s (StartTransaction can lag after Preparing).
  const session = await pollActiveSession(uid, chargerId, connectorId, 90);
  if (session) return session;

  const ended = await findRecentEndedSession(chargerId, connectorId);
  if (ended && ended.energyKwh < 0.05) {
    throw new Error(
      `Charger started then stopped immediately on Gun ${connectorId} (auth/cable). Plug in firmly, wait for Preparing, then try again.`
    );
  }

  throw new Error(
    `RemoteStart accepted but session did not start on Gun ${connectorId}. Plug in the cable (Preparing) and try again.`
  );
}

/**
 * Stop charging — prefer OCPP RemoteStop (same as web).
 * If the charger rejects (ghost/pre-OCPP CMS sessions), close the session in CMS
 * so the gun is freed and Live Session can end.
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

  // Ghost/orphan sessions (created before OCPP wiring, or CMS-only): no live tx on charger.
  const ageMs = Date.now() - new Date(session.startTime).getTime();
  const looksOrphan =
    transactionId == null ||
    !Number.isFinite(Number(transactionId)) ||
    (ageMs > 6 * 60 * 60 * 1000 && Number(session.energyKwh ?? 0) <= 0.01);

  if (looksOrphan || !ocppService.isOcppGatewayConfigured() || !chargePointId) {
    console.warn("[session] closing CMS session without RemoteStop (orphan/pre-OCPP)", sessionId);
    await simulator.simulateStopSession(sessionId);
    return;
  }

  try {
    const result = await ocppService.remoteStopTransaction({
      chargePointId,
      transactionId: Number(transactionId),
    });
    if (result.accepted) {
      const stopped = await pollSessionStopped(sessionId, uid);
      if (!stopped) {
        await simulator.simulateStopSession(sessionId);
      }
      return;
    }
    // Charger rejected — typical for pre-OCPP / unknown transactionId.
    console.warn("[session] RemoteStop rejected; force-closing CMS session", sessionId);
    await simulator.simulateStopSession(sessionId);
  } catch (e) {
    console.warn("[session] RemoteStop failed; force-closing CMS session", e);
    await simulator.simulateStopSession(sessionId);
  }
}
