import { config } from "../config.js";
import { isAdminRfidBypassActive } from "../ocpp/adminBypass.js";
import { getSupabase } from "./client.js";

export interface ChargerRow {
  id: string;
  charge_point_id: string;
  name: string;
  charger_type: string;
  status: string;
}

export interface RfidLookup {
  cardId: string;
  userId: string;
  uid: string;
}

const OCPP_CONNECTOR_STATUSES = new Set([
  "Available",
  "Preparing",
  "Charging",
  "SuspendedEVSE",
  "SuspendedEV",
  "Finishing",
  "Reserved",
  "Unavailable",
  "Faulted",
]);

function mapOcppConnectorStatus(ocppStatus: string): string {
  return OCPP_CONNECTOR_STATUSES.has(ocppStatus) ? ocppStatus : "Unavailable";
}

const OCPP_STOP_REASON: Record<string, string> = {
  EmergencyStop: "EmergencyStop",
  EVDisconnected: "EVDisconnected",
  HardReset: "HardReset",
  SoftReset: "SoftReset",
  PowerLoss: "PowerLoss",
  Remote: "Remote",
  DeAuthorized: "DeAuthorized",
  Other: "Other",
  Local: "Local",
  Reboot: "Reboot",
};

let fallbackUserId: string | null = null;

export async function findChargerByChargePointId(chargePointId: string): Promise<ChargerRow | null> {
  const { data, error } = await getSupabase()
    .from("EV_Chargers")
    .select("id, charge_point_id, name, charger_type, status")
    .eq("charge_point_id", chargePointId.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data as ChargerRow | null;
}

export interface FleetChargerRow {
  id: string;
  charge_point_id: string;
  name: string;
  charger_type: string;
  status: string;
  location: string | null;
  manufacturer: string | null;
  is_simulated: boolean;
}

/** All registered chargers from DB — no fixed fleet size limit. */
export async function listFleetChargers(): Promise<FleetChargerRow[]> {
  const { data, error } = await getSupabase()
    .from("EV_Chargers")
    .select("id, charge_point_id, name, charger_type, status, location, manufacturer, is_simulated")
    .order("charge_point_id");
  if (error) throw error;
  return (data ?? []) as FleetChargerRow[];
}

export async function markChargerOffline(chargePointId: string): Promise<void> {
  const charger = await findChargerByChargePointId(chargePointId);
  if (!charger) return;
  const now = new Date().toISOString();
  await getSupabase()
    .from("EV_Chargers")
    .update({ status: "offline", updated_at: now })
    .eq("id", charger.id);
  await logEvent(charger.id, chargePointId, null, "Disconnected", { timestamp: now });
}

export async function recordBootNotification(
  chargePointId: string,
  payload: Record<string, unknown>
): Promise<ChargerRow | null> {
  const now = new Date().toISOString();
  const vendor = String(payload.chargePointVendor ?? "");
  const model = String(payload.chargePointModel ?? "");
  const firmware = String(payload.firmwareVersion ?? "");

  const existing = await findChargerByChargePointId(chargePointId);
  if (!existing) {
    await logEvent(null, chargePointId, null, "BootNotification", {
      ...payload,
      warning: "Unknown charge point — register in admin first",
    });
    return null;
  }

  const { error } = await getSupabase()
    .from("EV_Chargers")
    .update({
      manufacturer: vendor || undefined,
      model: model || undefined,
      firmware_version: firmware || undefined,
      status: "online",
      last_heartbeat_at: now,
      last_status_change_at: now,
      updated_at: now,
    })
    .eq("id", existing.id);

  if (error) throw error;
  await logEvent(existing.id, chargePointId, null, "BootNotification", payload);
  return existing;
}

export async function recordHeartbeat(chargerId: string, chargePointId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from("EV_Chargers")
    .update({
      last_heartbeat_at: now,
      status: "online",
      updated_at: now,
    })
    .eq("id", chargerId);
  if (error) throw error;
  await logEvent(chargerId, chargePointId, null, "Heartbeat", { timestamp: now });
}

export async function recordStatusNotification(
  chargerId: string,
  chargePointId: string,
  connectorId: number,
  ocppStatus: string,
  payload: Record<string, unknown>
): Promise<void> {
  const connectorStatus = mapOcppConnectorStatus(ocppStatus);
  const now = new Date().toISOString();

  if (connectorId > 0) {
    const { error } = await getSupabase()
      .from("EV_ChargerConnectors")
      .update({ status: connectorStatus, updated_at: now })
      .eq("charger_id", chargerId)
      .eq("connector_id", connectorId);
    if (error) throw error;
  } else if (ocppStatus === "Faulted") {
    const { error } = await getSupabase()
      .from("EV_ChargerConnectors")
      .update({ status: "Faulted", updated_at: now })
      .eq("charger_id", chargerId);
    if (error) throw error;
  }

  const chargerStatus = ocppStatus === "Faulted" ? "faulted" : "online";
  await getSupabase()
    .from("EV_Chargers")
    .update({
      status: chargerStatus,
      last_status_change_at: now,
      last_heartbeat_at: now,
      updated_at: now,
    })
    .eq("id", chargerId);

  await logEvent(chargerId, chargePointId, connectorId || null, "StatusNotification", {
    status: ocppStatus,
    ...payload,
  });
}

export async function lookupRfid(idTag: string): Promise<RfidLookup | null> {
  const { data, error } = await getSupabase()
    .from("EV_RFIDCards")
    .select("id, uid, user_id, status")
    .ilike("uid", idTag.trim())
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "active" || !data.user_id) return null;
  return { cardId: data.id, userId: data.user_id, uid: data.uid };
}

export async function getFallbackUserId(): Promise<string> {
  if (fallbackUserId) return fallbackUserId;
  const { data, error } = await getSupabase()
    .from("EV_Users")
    .select("id")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("No active user in EV_Users for OCPP sessions");
  fallbackUserId = data.id;
  return data.id;
}

export async function authorizeIdTag(
  idTag: string,
  chargePointId?: string
): Promise<"Accepted" | "Invalid" | "Blocked"> {
  if (config.bypassRfidAuth || (chargePointId && isAdminRfidBypassActive(chargePointId))) {
    return "Accepted";
  }
  const { data, error } = await getSupabase()
    .from("EV_RFIDCards")
    .select("id, status, user_id")
    .ilike("uid", idTag.trim())
    .maybeSingle();
  if (error) throw error;
  if (!data) return "Invalid";
  if (data.status !== "active") return "Blocked";
  if (!data.user_id) return "Invalid";
  return "Accepted";
}

export async function nextTransactionId(): Promise<number> {
  const { data, error } = await getSupabase()
    .from("EV_ChargingSessions")
    .select("transaction_id")
    .order("transaction_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const max = Number(data?.transaction_id ?? 0);
  return max + 1;
}

export async function getActiveTariffId(chargerType: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from("EV_Tariffs")
    .select("id")
    .eq("is_active", true)
    .eq("applies_to", chargerType)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/** Per-charger override first, then type default. */
export async function getTariffIdForCharger(chargerId: string, chargerType: string): Promise<string | null> {
  const { data: charger, error: chargerError } = await getSupabase()
    .from("EV_Chargers")
    .select("tariff_id")
    .eq("id", chargerId)
    .maybeSingle();
  if (chargerError) throw chargerError;

  const overrideId = charger?.tariff_id as string | null | undefined;
  if (overrideId) {
    const { data: tariff, error: tariffError } = await getSupabase()
      .from("EV_Tariffs")
      .select("id")
      .eq("id", overrideId)
      .eq("is_active", true)
      .maybeSingle();
    if (tariffError) throw tariffError;
    if (tariff?.id) return tariff.id as string;
  }

  return getActiveTariffId(chargerType);
}

export async function startTransaction(params: {
  chargerId: string;
  chargePointId: string;
  connectorId: number;
  idTag: string;
  meterStart: number;
  timestamp: string;
  chargerType: string;
}): Promise<number> {
  const rfid = await lookupRfid(params.idTag);
  const userId = rfid?.userId ?? (await getFallbackUserId());
  const transactionId = await nextTransactionId();
  const tariffId = await getTariffIdForCharger(params.chargerId, params.chargerType);
  const now = params.timestamp || new Date().toISOString();

  const { error: sessionError } = await getSupabase().from("EV_ChargingSessions").insert({
    transaction_id: transactionId,
    charger_id: params.chargerId,
    connector_id: params.connectorId,
    user_id: userId,
    rfid_card_id: rfid?.cardId ?? null,
    tariff_id: tariffId,
    start_time: now,
    energy_kwh: 0,
    start_meter: params.meterStart / 1000,
    status: "active",
    authorization_method: "RFID",
  });
  if (sessionError) throw sessionError;

  await getSupabase()
    .from("EV_ChargerConnectors")
    .update({ status: "Charging", updated_at: now })
    .eq("charger_id", params.chargerId)
    .eq("connector_id", params.connectorId);

  await getSupabase()
    .from("EV_Chargers")
    .update({ status: "online", last_heartbeat_at: now, updated_at: now })
    .eq("id", params.chargerId);

  if (rfid) {
    await getSupabase()
      .from("EV_RFIDCards")
      .update({ last_used_at: now, updated_at: now })
      .eq("id", rfid.cardId);
  }

  await logEvent(params.chargerId, params.chargePointId, params.connectorId, "StartTransaction", {
    transactionId,
    idTag: params.idTag,
    meterStart: params.meterStart,
  });

  return transactionId;
}

export async function stopTransaction(params: {
  transactionId: number;
  meterStop: number;
  timestamp: string;
  reason?: string;
}): Promise<void> {
  const { data: session, error: findError } = await getSupabase()
    .from("EV_ChargingSessions")
    .select("id, charger_id, connector_id, start_meter, energy_kwh")
    .eq("transaction_id", params.transactionId)
    .eq("status", "active")
    .maybeSingle();
  if (findError) throw findError;
  if (!session) throw new Error(`No active session for transaction ${params.transactionId}`);

  const endMeterKwh = params.meterStop / 1000;
  const startMeter = Number(session.start_meter ?? 0);
  const energyKwh = Math.max(Number(session.energy_kwh ?? 0), endMeterKwh - startMeter);
  const stopReason = OCPP_STOP_REASON[params.reason ?? ""] ?? params.reason ?? "Other";
  const now = params.timestamp || new Date().toISOString();

  const { error } = await getSupabase()
    .from("EV_ChargingSessions")
    .update({
      end_time: now,
      end_meter: endMeterKwh,
      energy_kwh: energyKwh,
      current_power_kw: 0,
      status: "completed",
      stop_reason: stopReason,
      updated_at: now,
    })
    .eq("id", session.id);
  if (error) throw error;

  await getSupabase()
    .from("EV_ChargerConnectors")
    .update({ status: "Available", updated_at: now })
    .eq("charger_id", session.charger_id)
    .eq("connector_id", session.connector_id);

  const charger = await getSupabase()
    .from("EV_Chargers")
    .select("charge_point_id")
    .eq("id", session.charger_id)
    .single();

  await logEvent(
    session.charger_id,
    charger.data?.charge_point_id ?? "",
    session.connector_id,
    "StopTransaction",
    { transactionId: params.transactionId, meterStop: params.meterStop, reason: stopReason }
  );
}

export async function recordMeterValues(params: {
  transactionId: number;
  chargerId: string;
  chargePointId: string;
  connectorId: number;
  sampledAt: string;
  energyKwh: number | null;
  powerKw: number | null;
  soc: number | null;
}): Promise<void> {
  const { data: session, error: findError } = await getSupabase()
    .from("EV_ChargingSessions")
    .select("id")
    .eq("transaction_id", params.transactionId)
    .eq("status", "active")
    .maybeSingle();
  if (findError) throw findError;
  if (!session) return;

  const { error: meterError } = await getSupabase().from("EV_MeterValues").insert({
    session_id: session.id,
    charger_id: params.chargerId,
    connector_id: params.connectorId,
    sampled_at: params.sampledAt,
    energy_kwh: params.energyKwh,
    power_kw: params.powerKw,
    soc: params.soc,
  });
  if (meterError) throw meterError;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.energyKwh != null) updates.energy_kwh = params.energyKwh;
  if (params.powerKw != null) updates.current_power_kw = params.powerKw;
  if (params.soc != null) updates.soc = params.soc;

  await getSupabase().from("EV_ChargingSessions").update(updates).eq("id", session.id);

  await logEvent(params.chargerId, params.chargePointId, params.connectorId, "MeterValues", {
    transactionId: params.transactionId,
    energyKwh: params.energyKwh,
    powerKw: params.powerKw,
    soc: params.soc,
  });
}

export async function getSessionByTransactionId(transactionId: number) {
  const { data, error } = await getSupabase()
    .from("EV_ChargingSessions")
    .select("id, transaction_id, connector_id, status")
    .eq("transaction_id", transactionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getConnectorStatus(chargerId: string, connectorId: number) {
  const { data, error } = await getSupabase()
    .from("EV_ChargerConnectors")
    .select("connector_id, connector_type, max_power_kw, status")
    .eq("charger_id", chargerId)
    .eq("connector_id", connectorId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function logEvent(
  chargerId: string | null,
  chargePointId: string,
  connectorId: number | null,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  let resolvedChargerId = chargerId;
  if (!resolvedChargerId && chargePointId) {
    const charger = await findChargerByChargePointId(chargePointId);
    resolvedChargerId = charger?.id ?? null;
  }
  if (!resolvedChargerId) return;

  await getSupabase().from("EV_ChargerEvents").insert({
    charger_id: resolvedChargerId,
    connector_id: connectorId,
    event_type: eventType,
    payload,
  });
}

export function parseMeterSampledValues(meterValue: unknown): {
  energyKwh: number | null;
  powerKw: number | null;
  soc: number | null;
  sampledAt: string;
} {
  const list = Array.isArray(meterValue) ? meterValue : [];
  const first = (list[0] as Record<string, unknown>) ?? {};
  const sampledAt = String(first.timestamp ?? new Date().toISOString());
  const sampled = Array.isArray(first.sampledValue) ? first.sampledValue : [];

  let energyKwh: number | null = null;
  let powerKw: number | null = null;
  let soc: number | null = null;

  for (const raw of sampled) {
    const sv = raw as Record<string, unknown>;
    const measurand = String(sv.measurand ?? "Energy.Active.Import.Register");
    const value = Number(sv.value);
    if (Number.isNaN(value)) continue;
    const unit = String(sv.unit ?? "");

    if (measurand.includes("Energy")) {
      energyKwh = unit === "Wh" || unit === "" ? value / 1000 : value;
    } else if (measurand.includes("Power")) {
      powerKw = unit === "W" || unit === "" ? value / 1000 : value;
    } else if (measurand === "SoC") {
      soc = Math.round(value);
    }
  }

  return { energyKwh, powerKw, soc, sampledAt };
}
