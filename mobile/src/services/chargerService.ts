import { requireSupabase } from "../utils/supabaseClient";
import { sortChargersByDistance } from "./locationService";
import { parseChargeQr } from "../utils/qrParser";
import { isSimulationEnabled } from "../utils/simulationMode";
import type { Charger, ChargerConnector, ChargerStatusFilter } from "../types";

export type { ChargerStatusFilter };

export interface ChargersQuery {
  status?: ChargerStatusFilter | string;
  search?: string;
  onlineOnly?: boolean;
  /** Prefer false for the main list — connector/heartbeat filters hide real inventory. */
  availableOnly?: boolean;
}

const CHARGER_COLUMNS =
  "id, charge_point_id, name, manufacturer, model, charger_type, max_power_kw, status, location, latitude, longitude, is_simulated, tariff_id, allow_admin_bypass, last_heartbeat_at, created_at, updated_at";

const CHARGEABLE_STATUSES = new Set(["online", "available"]);
const FAULTED_STATUSES = new Set(["faulted", "error", "unavailable"]);

function mapConnector(c: Record<string, unknown>): ChargerConnector {
  return {
    id: c.id as string,
    connectorId: c.connector_id as number,
    type: c.connector_type as string,
    maxPowerKw: Number(c.max_power_kw),
    status: c.status as string,
  };
}

function mapCharger(row: Record<string, unknown>): Charger {
  const connectors = (row.EV_ChargerConnectors as Record<string, unknown>[]) ?? [];
  return {
    id: row.id as string,
    chargePointId: row.charge_point_id as string,
    name: row.name as string,
    manufacturer: row.manufacturer != null ? String(row.manufacturer) : null,
    model: row.model != null ? String(row.model) : null,
    type: row.charger_type as string,
    maxPowerKw: Number(row.max_power_kw ?? 0),
    status: (row.status as string) ?? "",
    location: (row.location as string) ?? "",
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    lastHeartbeat: (row.last_heartbeat_at as string) ?? null,
    isSimulated: Boolean(row.is_simulated),
    tariffId: row.tariff_id != null ? String(row.tariff_id) : null,
    allowAdminBypass: row.allow_admin_bypass !== false,
    connectors: connectors.map(mapConnector),
  };
}

/** Mobile start-charging gate — only online/available chargers. */
export function canStartCharging(charger: Pick<Charger, "status"> | null | undefined): boolean {
  const status = String(charger?.status || "")
    .toLowerCase()
    .trim();
  return CHARGEABLE_STATUSES.has(status);
}

export type ChargerBlockReason = "offline" | "faulted" | "unknown";

export function getChargerBlockReason(
  charger: Pick<Charger, "status"> | null | undefined
): ChargerBlockReason | null {
  if (canStartCharging(charger)) return null;
  const status = String(charger?.status || "")
    .toLowerCase()
    .trim();
  if (!status) return "unknown";
  if (status === "offline") return "offline";
  if (FAULTED_STATUSES.has(status)) return "faulted";
  return "unknown";
}

/** i18n key for why charging is blocked. */
export function getChargerUnavailableMessageKey(
  charger: Pick<Charger, "status"> | null | undefined
): string {
  const reason = getChargerBlockReason(charger);
  if (reason === "offline") return "charger.offlineCannotCharge";
  if (reason === "faulted") return "charger.faultedCannotCharge";
  return "charger.statusUnavailable";
}

/**
 * Re-fetch charger from EV_Chargers and ensure it is still online/available.
 * Also calls mobile-only RPC when deployed (does not affect admin web).
 */
export async function assertChargerOnlineForMobile(chargerId: string): Promise<Charger> {
  // Mobile-only RPC — ignore if not deployed yet.
  const { error: rpcError } = await requireSupabase().rpc("ev_mobile_assert_charger_online", {
    p_charger_id: chargerId,
  });
  if (rpcError && !/ev_mobile_assert_charger_online|42883|function .* does not exist/i.test(rpcError.message)) {
    if (/not online|not available|CHARGER_NOT_ONLINE/i.test(rpcError.message)) {
      throw new Error("Charger is not online. Please select another charger.");
    }
    // fall through to client fetch for other errors
  } else if (!rpcError) {
    const fresh = await getChargerById(chargerId);
    if (!fresh) throw new Error("Charger not found");
    return fresh;
  }

  const { data, error } = await requireSupabase()
    .from("EV_Chargers")
    .select(`${CHARGER_COLUMNS}, EV_ChargerConnectors(*)`)
    .eq("id", chargerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Charger not found");

  const charger = mapCharger(data as Record<string, unknown>);
  if (!canStartCharging(charger)) {
    throw new Error("Charger is not online. Please select another charger.");
  }
  return charger;
}

function getSupabaseProjectHint(): string {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] || host || "(missing EXPO_PUBLIC_SUPABASE_URL)";
  } catch {
    return url || "(missing EXPO_PUBLIC_SUPABASE_URL)";
  }
}

/**
 * Broad fetch of EV_Chargers — no status / is_simulated / tariff filters.
 * RLS note: if this returns [] with no error, ensure:
 *   create policy "Allow authenticated users to read chargers"
 *   on public."EV_Chargers" for select to authenticated using (true);
 * (Do not apply SQL from the app.)
 */
export async function fetchChargers(search = ""): Promise<Charger[]> {
  const project = getSupabaseProjectHint();
  console.log("[chargers] supabase project:", project);

  let q = requireSupabase()
    .from("EV_Chargers")
    .select(`${CHARGER_COLUMNS}, EV_ChargerConnectors(*)`)
    .order("name");

  const s = search.trim();
  if (s) {
    q = q.or(`name.ilike.%${s}%,charge_point_id.ilike.%${s}%,location.ilike.%${s}%`);
  }

  const { data, error } = await q;

  if (error) {
    console.error("[chargers] query error:", error.message, error);
    throw new Error(error.message || "Unable to load chargers");
  }

  const list = (data ?? []).map((row) => mapCharger(row as Record<string, unknown>));
  // Hide simulated unless Simulation Mode; never show decommissioned in mobile fleet.
  let filtered = list.filter((c) => String(c.status || "").toLowerCase() !== "decommissioned");
  filtered = isSimulationEnabled() ? filtered : filtered.filter((c) => !c.isSimulated);
  console.log("[chargers] fetched count:", filtered.length);
  console.log(
    "[chargers] fetched",
    filtered.map((c) => ({
      id: c.chargePointId,
      status: c.status,
      type: c.type,
      isSimulated: c.isSimulated,
      hasCoords: c.latitude != null && c.longitude != null,
      normalizedStatus: String(c.status || "").toLowerCase().trim(),
    }))
  );
  if (filtered.length > 0) {
    console.log("[chargers] first charger:", filtered[0]);
  } else {
    console.warn(
      "EV_Chargers returned zero rows. Check RLS policy or Supabase environment config."
    );
  }

  return filtered;
}

/** Client-side status tabs. Simulation Mode must not hide chargers. */
export function filterChargers(
  chargers: Charger[],
  status: ChargerStatusFilter | string = "all"
): Charger[] {
  const key = String(status || "all").toLowerCase();
  console.log("[chargers] selected filter:", key);

  if (key === "all") return chargers;

  if (key === "online") {
    return chargers.filter((c) => canStartCharging(c));
  }

  if (key === "offline") {
    return chargers.filter((c) => (c.status || "").toLowerCase().trim() === "offline");
  }

  if (key === "faulted") {
    return chargers.filter((c) => FAULTED_STATUSES.has((c.status || "").toLowerCase().trim()));
  }

  return chargers.filter((c) => (c.status || "").toLowerCase() === key);
}

export async function getChargers(query: ChargersQuery = {}): Promise<Charger[]> {
  const { status = "all", search = "", onlineOnly = false, availableOnly = false } = query;

  let list = await fetchChargers(search);

  if (onlineOnly) {
    list = filterChargers(list, "online");
  } else {
    list = filterChargers(list, status);
  }

  if (availableOnly) {
    list = list.filter(isChargerAvailableForCharging);
  }

  return list;
}

/** @deprecated use getNearestChargers */
export async function getNearbyChargers(): Promise<Charger[]> {
  return getChargers({ onlineOnly: true });
}

export async function getNearestChargers(
  userLat: number,
  userLng: number,
  limit = 20
): Promise<Charger[]> {
  const list = await fetchChargers();
  const withCoords = list.filter((c) => c.latitude != null && c.longitude != null);
  return sortChargersByDistance(withCoords, { latitude: userLat, longitude: userLng }).slice(0, limit);
}

export interface QrValidationResult {
  charger: Charger;
  connectorId: number;
}

export async function validateQr(raw: string): Promise<QrValidationResult> {
  const parsed = parseChargeQr(raw);
  if (!parsed) throw new Error("INVALID_QR");

  let charger: Charger | undefined;
  if (parsed.chargerId) {
    charger = await getChargerById(parsed.chargerId);
  } else if (parsed.chargePointId) {
    charger = await getChargerByChargePointId(parsed.chargePointId);
  }

  if (!charger) throw new Error("CHARGER_NOT_FOUND");
  if (!canStartCharging(charger)) {
    throw new Error("Cannot start charging because this charger is not online.");
  }

  const connector = charger.connectors.find((c) => c.connectorId === parsed.connectorId);
  if (!connector) throw new Error("CONNECTOR_NOT_FOUND");
  if (!isConnectorAvailable(connector.status)) {
    throw new Error("CONNECTOR_NOT_AVAILABLE");
  }

  return { charger, connectorId: parsed.connectorId };
}

export async function getChargerById(id: string): Promise<Charger | undefined> {
  const { data, error } = await requireSupabase()
    .from("EV_Chargers")
    .select(`${CHARGER_COLUMNS}, EV_ChargerConnectors(*)`)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapCharger(data as Record<string, unknown>) : undefined;
}

export async function getChargerByChargePointId(chargePointId: string): Promise<Charger | undefined> {
  const { data, error } = await requireSupabase()
    .from("EV_Chargers")
    .select(`${CHARGER_COLUMNS}, EV_ChargerConnectors(*)`)
    .eq("charge_point_id", chargePointId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapCharger(data as Record<string, unknown>) : undefined;
}

/**
 * Gun/connector can accept a start — matches web `canRemoteStartConnector`
 * (OCPP Available or Preparing / cable plugged).
 */
export function isConnectorAvailable(status: string | null | undefined): boolean {
  const s = String(status || "")
    .toLowerCase()
    .trim();
  return s === "available" || s === "preparing";
}

/** True when gun status or an active CMS session blocks a new start. */
export function canStartOnConnector(
  status: string | null | undefined,
  hasActiveSession = false
): boolean {
  if (hasActiveSession) return false;
  return isConnectorAvailable(status);
}

export function getConnectorBlockMessageKey(
  status: string | null | undefined,
  hasActiveSession = false
): string {
  if (hasActiveSession) return "charger.gunInUse";
  const s = String(status || "")
    .toLowerCase()
    .trim();
  if (s === "charging") return "charger.gunInUse";
  if (s === "faulted" || s === "error") return "charger.gunFaulted";
  if (s === "unavailable") return "charger.gunUnavailable";
  return "charger.notAvailable";
}

/** Connector IDs that already have an active charging session on this charger. */
export async function getBusyConnectorIds(chargerId: string): Promise<Set<number>> {
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select("connector_id")
    .eq("charger_id", chargerId)
    .eq("status", "active");

  if (error) throw error;
  return new Set((data ?? []).map((row) => Number((row as { connector_id: number }).connector_id)));
}

export function hasAvailableConnector(charger: Charger): boolean {
  return charger.connectors.some((c) => isConnectorAvailable(c.status));
}

/** Prefer canStartCharging for mobile start gate; this also considers connectors. */
export function isChargerAvailableForCharging(charger: Charger): boolean {
  if (!canStartCharging(charger)) return false;
  if (charger.connectors.length === 0) return true;
  return hasAvailableConnector(charger);
}
