import { config } from "../config.js";
import { isAdminRfidBypassActive } from "../ocpp/adminBypass.js";
import { getSupabase } from "./client.js";

export interface ChargerRow {
  id: string;
  charge_point_id: string;
  name: string;
  charger_type: string;
  status: string;
  allow_admin_bypass?: boolean;
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
  const cpId = chargePointId.trim();
  const { data, error } = await getSupabase()
    .from("EV_Chargers")
    .select("id, charge_point_id, name, charger_type, status, allow_admin_bypass")
    .ilike("charge_point_id", cpId)
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
  /** Prefer this user (mobile/web RemoteStart) over RFID / fallback. */
  preferredUserId?: string | null;
}): Promise<number> {
  const rfid = await lookupRfid(params.idTag);
  const userId =
    params.preferredUserId?.trim() || rfid?.userId || (await getFallbackUserId());
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
    authorization_method: rfid ? "RFID" : params.preferredUserId ? "Mobile" : "RFID",
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

  // Prepaid settlement (amount/time pay-before-charge)
  try {
    const { error: settleError } = await getSupabase().rpc("ev_settle_prepaid_session", {
      p_session_id: session.id,
    });
    if (settleError) {
      console.warn("[ocpp] prepaid settle failed:", settleError.message);
    }
  } catch (err) {
    console.warn("[ocpp] prepaid settle error:", err);
  }
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
  /** Absolute energy register in kWh (Energy.Active.Import.Register), if present. */
  energyRegisterKwh?: number | null;
  rawSamples?: unknown;
}): Promise<{ shouldRemoteStop: boolean; transactionId: number; reason: string } | null> {
  const { data: session, error: findError } = await getSupabase()
    .from("EV_ChargingSessions")
    .select(
      "id, start_time, start_meter, energy_kwh, prepaid_mode, prepaid_value, prepaid_energy_cap_kwh, prepaid_expires_at, prepaid_duration_minutes, prepaid_total_inr, tariff_id, transaction_id, payment_status, payment_mode"
    )
    .eq("transaction_id", params.transactionId)
    .eq("status", "active")
    .maybeSingle();
  if (findError) throw findError;
  if (!session) return null;

  const startMeterKwh = Number(session.start_meter ?? 0);
  const prevEnergyKwh = Number(session.energy_kwh ?? 0);
  const startMs = new Date(String((session as { start_time?: string }).start_time ?? "")).getTime();
  const ageMs = Number.isFinite(startMs) ? Math.max(0, Date.now() - startMs) : 0;

  // Session energy = register − start_meter (preferred) or interval energy.
  // Never treat a lifetime absolute register as session kWh when start_meter is 0.
  let sessionEnergyKwh = prevEnergyKwh;
  let nextStartMeter: number | null = null;

  if (params.energyRegisterKwh != null && params.energyRegisterKwh > 0) {
    if (!(startMeterKwh > 0)) {
      // First absolute reading becomes the baseline — energy stays 0 this tick.
      nextStartMeter = params.energyRegisterKwh;
      sessionEnergyKwh = 0;
    } else if (params.energyRegisterKwh >= startMeterKwh) {
      const delta = params.energyRegisterKwh - startMeterKwh;
      // Cap absurd deltas (unit mismatch / meter reset).
      if (delta >= 0 && delta < 500) {
        sessionEnergyKwh = Math.max(sessionEnergyKwh, delta);
      }
    }
  }

  if (params.energyKwh != null && params.energyKwh > 0) {
    const effectiveStart = nextStartMeter ?? startMeterKwh;
    const looksLikeAbsoluteRegister =
      effectiveStart > 0 &&
      params.energyKwh >= effectiveStart &&
      params.energyKwh > sessionEnergyKwh + 0.5;
    if (looksLikeAbsoluteRegister) {
      const delta = params.energyKwh - effectiveStart;
      if (delta >= 0 && delta < 500) {
        sessionEnergyKwh = Math.max(sessionEnergyKwh, delta);
      }
    } else if (params.energyKwh < 200) {
      // Interval / session energy measurand (already relative).
      sessionEnergyKwh = Math.max(sessionEnergyKwh, params.energyKwh);
    }
  }

  const powerKw = params.powerKw;

  const { error: meterError } = await getSupabase().from("EV_MeterValues").insert({
    session_id: session.id,
    charger_id: params.chargerId,
    connector_id: params.connectorId,
    sampled_at: params.sampledAt,
    energy_kwh: sessionEnergyKwh,
    power_kw: powerKw,
    soc: params.soc,
  });
  if (meterError) throw meterError;

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    energy_kwh: sessionEnergyKwh,
  };
  if (nextStartMeter != null) updates.start_meter = nextStartMeter;
  if (powerKw != null) updates.current_power_kw = powerKw;
  if (params.soc != null) updates.soc = params.soc;

  await getSupabase().from("EV_ChargingSessions").update(updates).eq("id", session.id);

  await logEvent(params.chargerId, params.chargePointId, params.connectorId, "MeterValues", {
    transactionId: params.transactionId,
    energyKwh: sessionEnergyKwh,
    powerKw,
    soc: params.soc,
    energyRegisterKwh: params.energyRegisterKwh ?? null,
    // Keep raw sample for vendor debugging when Energy/Power report as 0.
    rawSamples: params.rawSamples ?? null,
  });

  // Prepaid auto-stop only after payment is collected — never while checkout is pending.
  const paymentStatus = String((session as { payment_status?: string }).payment_status ?? "").toLowerCase();
  const paymentMode = String((session as { payment_mode?: string }).payment_mode ?? "").toLowerCase();
  const prepaidPaid =
    paymentMode === "prepaid" && (paymentStatus === "paid" || paymentStatus === "success");
  if (!prepaidPaid) {
    return null;
  }

  // Avoid false stops in the first seconds (baseline adoption / noisy first samples).
  if (ageMs < 20_000) {
    return null;
  }

  // Reject implausible energy (would stop ₹50 sessions instantly).
  const maxPlausibleKwh = Math.max(1, (ageMs / 3_600_000) * 400 + 1);
  if (sessionEnergyKwh > maxPlausibleKwh) {
    console.warn(
      `[ocpp] Skipping prepaid auto-stop: energy ${sessionEnergyKwh.toFixed(3)} kWh implausible for age ${Math.round(ageMs / 1000)}s`
    );
    return null;
  }

  const prepaidMode = session.prepaid_mode as string | null;
  if (prepaidMode === "amount") {
    let cap =
      session.prepaid_energy_cap_kwh != null ? Number(session.prepaid_energy_cap_kwh) : NaN;
    // Fallback: derive kWh from prepaid base amount when cap was never written.
    if (!(cap > 0) && session.prepaid_value != null) {
      const base = Number(session.prepaid_value);
      if (base > 0) {
        try {
          let rate = 0;
          if (session.tariff_id) {
            const { data: tariff } = await getSupabase()
              .from("EV_Tariffs")
              .select("rate_per_kwh")
              .eq("id", session.tariff_id)
              .maybeSingle();
            rate = Number(tariff?.rate_per_kwh ?? 0);
          }
          if (!(rate > 0)) {
            const { data: charger } = await getSupabase()
              .from("EV_Chargers")
              .select("tariff_id, charger_type")
              .eq("id", params.chargerId)
              .maybeSingle();
            if (charger?.tariff_id) {
              const { data: ct } = await getSupabase()
                .from("EV_Tariffs")
                .select("rate_per_kwh")
                .eq("id", charger.tariff_id)
                .maybeSingle();
              rate = Number(ct?.rate_per_kwh ?? 0);
            }
          }
          if (rate > 0) cap = base / rate;
        } catch {
          // ignore — no auto-stop without a rate
        }
      }
    }
    if (cap > 0 && sessionEnergyKwh >= cap) {
      return {
        shouldRemoteStop: true,
        transactionId: params.transactionId,
        reason: "prepaid_amount",
      };
    }
  }
  if (prepaidMode === "time") {
    let expiresMs = session.prepaid_expires_at
      ? new Date(session.prepaid_expires_at as string).getTime()
      : NaN;
    if (!Number.isFinite(expiresMs)) {
      const mins = Number(
        (session as { prepaid_duration_minutes?: number }).prepaid_duration_minutes ??
          session.prepaid_value ??
          0
      );
      if (mins > 0 && Number.isFinite(startMs)) {
        expiresMs = startMs + mins * 60_000;
      }
    }
    if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
      return {
        shouldRemoteStop: true,
        transactionId: params.transactionId,
        reason: "prepaid_time",
      };
    }
  }

  return null;
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

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim().replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function energyToKwh(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === "wh" || u === "") return value / 1000;
  if (u === "kwh" || u === "kw.h") return value;
  // Unknown unit: values > 100 are almost always Wh on EVSE meters.
  return value > 100 ? value / 1000 : value;
}

function powerToKw(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === "w" || u === "") return value / 1000;
  if (u === "kw") return value;
  return value > 200 ? value / 1000 : value;
}

export function parseMeterSampledValues(meterValue: unknown): {
  energyKwh: number | null;
  energyRegisterKwh: number | null;
  powerKw: number | null;
  soc: number | null;
  sampledAt: string;
  rawSamples: unknown;
} {
  const list = Array.isArray(meterValue) ? meterValue : [];
  const first = (list[0] as Record<string, unknown>) ?? {};
  const sampledAt = String(first.timestamp ?? new Date().toISOString());

  let energyKwh: number | null = null;
  let energyRegisterKwh: number | null = null;
  let powerKw: number | null = null;
  let soc: number | null = null;
  let currentA: number | null = null;
  let voltageV: number | null = null;
  const rawSamples: Record<string, unknown>[] = [];

  for (const entry of list) {
    const block = (entry as Record<string, unknown>) ?? {};
    const sampled = Array.isArray(block.sampledValue) ? block.sampledValue : [];
    for (const raw of sampled) {
      const sv = raw as Record<string, unknown>;
      const measurand = String(sv.measurand ?? "Energy.Active.Import.Register");
      const value = toNumber(sv.value);
      if (value == null) continue;
      const unit = String(sv.unit ?? "");
      rawSamples.push({ measurand, value, unit, context: sv.context ?? null });

      const m = measurand.toLowerCase();
      if (m.includes("energy") && m.includes("register")) {
        const kwh = energyToKwh(value, unit);
        energyRegisterKwh = energyRegisterKwh == null ? kwh : Math.max(energyRegisterKwh, kwh);
        // Do NOT copy register into energyKwh — absolute lifetime kWh must not be
        // treated as session energy (that caused prepaid auto-stop within seconds).
      } else if (m.includes("energy")) {
        const kwh = energyToKwh(value, unit);
        // Prefer non-zero interval/session energy samples over zeros.
        if (energyKwh == null || (kwh > 0 && kwh >= (energyKwh ?? 0))) {
          energyKwh = kwh;
        }
      } else if (m.includes("power")) {
        const kw = powerToKw(value, unit);
        if (powerKw == null || kw > powerKw) powerKw = kw;
      } else if (m === "soc" || m.endsWith(".soc")) {
        soc = Math.round(value);
      } else if (m.includes("current") && !m.includes("import.register")) {
        currentA = value;
      } else if (m.includes("voltage")) {
        voltageV = value;
      }
    }
  }

  // Fallback: estimate DC power from Current × Voltage when Power measurand is missing/zero.
  if ((powerKw == null || powerKw === 0) && currentA != null && voltageV != null && currentA > 0 && voltageV > 0) {
    powerKw = (currentA * voltageV) / 1000;
  }

  return {
    energyKwh,
    energyRegisterKwh,
    powerKw,
    soc,
    sampledAt,
    rawSamples: rawSamples.slice(0, 20),
  };
}
