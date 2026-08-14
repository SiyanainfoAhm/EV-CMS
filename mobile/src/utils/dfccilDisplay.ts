import type { Charger, ChargerConnector } from "../types";
import { isSimulationEnabled } from "./simulationMode";

/** Stable AC/DC classification from charger_type / name. */
export function isDcCharger(charger: Pick<Charger, "type" | "name" | "chargePointId">): boolean {
  const blob = `${charger.type} ${charger.name} ${charger.chargePointId}`.toLowerCase();
  // Match DC as a token (handles "DC Fast", "DL-DC-CHARGER-001", etc.)
  return /(^|[^a-z])dc([^a-z]|$)/.test(blob) || blob.includes("fast");
}

export function chargerKindLabel(charger: Pick<Charger, "type" | "name" | "chargePointId">): "AC" | "DC" {
  return isDcCharger(charger) ? "DC" : "AC";
}

/** Plug type rule: AC → Type-2, DC → CCS-2 */
export function plugTypeForCharger(charger: Pick<Charger, "type" | "name" | "chargePointId">): string {
  return isDcCharger(charger) ? "CCS-2" : "Type-2";
}

export function plugTypeForConnector(
  charger: Pick<Charger, "type" | "name" | "chargePointId">,
  connector?: Pick<ChargerConnector, "type"> | null
): string {
  const raw = String(connector?.type || "").toUpperCase().replace(/\s+/g, "");
  if (raw.includes("CCS")) return "CCS-2";
  if (raw.includes("TYPE2") || raw === "TYPE-2" || raw.includes("TYPE_2")) return "Type-2";
  return plugTypeForCharger(charger);
}

export function normalizeLocationKey(location?: string | null): string {
  return String(location || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Fleet-visible: not decommissioned; hide simulated unless Simulation Mode on. */
export function isVisibleFleetCharger(charger: Charger): boolean {
  const status = String(charger.status || "")
    .toLowerCase()
    .trim();
  if (status === "decommissioned") return false;
  if (charger.isSimulated && !isSimulationEnabled()) return false;
  return true;
}

/** Sort within a site: AC then DC, then charge_point_id numeric-aware. */
export function sortChargersForDisplay(chargers: Charger[]): Charger[] {
  return [...chargers].sort((a, b) => {
    const kindA = chargerKindLabel(a);
    const kindB = chargerKindLabel(b);
    if (kindA !== kindB) return kindA === "AC" ? -1 : 1;
    return a.chargePointId.localeCompare(b.chargePointId, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

/**
 * Site-scoped AC/DC numbering.
 * Numbers restart per location and per kind (AC vs DC).
 * Only counts chargers passed in (already filtered to visible fleet).
 */
export function buildChargerDisplayIndexMap(chargers: Charger[]): Map<string, number> {
  const map = new Map<string, number>();
  const bySite = new Map<string, Charger[]>();

  for (const c of chargers) {
    const site = normalizeLocationKey(c.location) || "__default__";
    const list = bySite.get(site) ?? [];
    list.push(c);
    bySite.set(site, list);
  }

  for (const list of bySite.values()) {
    const sorted = sortChargersForDisplay(list);
    let ac = 0;
    let dc = 0;
    for (const c of sorted) {
      if (isDcCharger(c)) {
        dc += 1;
        map.set(c.id, dc);
      } else {
        ac += 1;
        map.set(c.id, ac);
      }
    }
  }

  return map;
}

/**
 * Display name like "DFCCIL AC Charger - 1".
 * Prefer site-scoped index from buildChargerDisplayIndexMap — never invent numbers
 * from global array length of unfiltered data.
 */
export function dfccilChargerDisplayName(
  charger: Pick<Charger, "name" | "type" | "chargePointId">,
  indexAmongKind?: number
): string {
  const kind = chargerKindLabel(charger);
  if (indexAmongKind != null && indexAmongKind > 0) {
    return `DFCCIL ${kind} Charger - ${indexAmongKind}`;
  }

  const name = String(charger.name || "").trim();
  if (/^dfccil\s+(ac|dc)\s+charger\s*-\s*\d+/i.test(name)) {
    return name.replace(/\s+/g, " ");
  }

  const n = extractTrailingNumber(charger.chargePointId) ?? extractTrailingNumber(name) ?? 1;
  return `DFCCIL ${kind} Charger - ${n}`;
}

function extractTrailingNumber(value: string): number | null {
  const m = String(value || "").match(/(\d+)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatPowerLine(
  charger: Pick<Charger, "type" | "name" | "chargePointId" | "maxPowerKw">
): string {
  const kind = chargerKindLabel(charger);
  const kw = Number(charger.maxPowerKw);
  const power = Number.isFinite(kw) && kw > 0 ? kw : kind === "DC" ? 60 : 7.4;
  const display = Number.isInteger(power) ? String(power) : power.toFixed(1);
  return `${kind} | ${display} kW`;
}

export function formatUptoPowerKw(kw: number | null | undefined, fallback: number): string {
  const n = Number(kw);
  const value = Number.isFinite(n) && n > 0 ? n : fallback;
  const display = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `Upto ${display} kW`;
}

export function formatLastUsed(lastHeartbeat?: string | null): string {
  if (!lastHeartbeat) return "Last used: —";
  const ageMs = Date.now() - new Date(lastHeartbeat).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "Last used: —";
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return "Last used: just now";
  if (mins < 60) return `Last used: ${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Last used: ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `Last used: ${days} day${days === 1 ? "" : "s"} ago`;
}

export function normalizeConnectorStatus(status: string | null | undefined): string {
  return String(status || "")
    .toLowerCase()
    .trim();
}

export function isConnectorSelectable(status: string | null | undefined): boolean {
  const s = normalizeConnectorStatus(status);
  return s === "available" || s === "preparing";
}

export function connectorStatusLabel(
  status: string | null | undefined,
  soc?: number | null
): string {
  const s = normalizeConnectorStatus(status);
  if (s === "available" || s === "preparing") return "Available";
  if (s === "charging") {
    if (soc != null && Number.isFinite(soc)) return `Charging - ${Math.round(soc)}%`;
    return "Charging";
  }
  if (s === "faulted" || s === "error") return "Faulted";
  if (s === "unavailable") return "Unavailable";
  if (!s) return "Unavailable";
  return status!.charAt(0).toUpperCase() + status!.slice(1);
}

/** Default display tariffs when live tariff not loaded yet (UI only). */
export const DEFAULT_DISPLAY_RATE_AC = 14.49;
export const DEFAULT_DISPLAY_RATE_DC = 21.99;

export function defaultDisplayRate(charger: Pick<Charger, "type" | "name" | "chargePointId">): number {
  return isDcCharger(charger) ? DEFAULT_DISPLAY_RATE_DC : DEFAULT_DISPLAY_RATE_AC;
}

export function stationTitleFromChargers(chargers: Charger[]): string {
  if (chargers.length === 0) return "DFCCIL Charging Station";
  const loc = String(chargers[0].location || "").trim();
  if (loc) return loc;
  return "DFCCIL Charging Station";
}

export function logChargerNumbering(chargers: Charger[], indexMap: Map<string, number>): void {
  console.log(
    "[charger-numbering]",
    chargers.map((c) => ({
      id: c.id,
      chargePointId: c.chargePointId,
      chargerType: c.type,
      isSimulated: c.isSimulated,
      status: c.status,
      location: c.location,
      displayIndex: indexMap.get(c.id) ?? null,
      displayName: dfccilChargerDisplayName(c, indexMap.get(c.id)),
    }))
  );
}

export function summarizeVisibleChargers(chargers: Charger[]): {
  totalActive: number;
  activeAc: number;
  activeDc: number;
  simulatedHiddenHint: number;
  decommissionedHint: number;
  missingCoordinates: number;
} {
  const visible = chargers.filter(isVisibleFleetCharger);
  return {
    totalActive: visible.length,
    activeAc: visible.filter((c) => !isDcCharger(c)).length,
    activeDc: visible.filter((c) => isDcCharger(c)).length,
    simulatedHiddenHint: chargers.filter((c) => c.isSimulated).length,
    decommissionedHint: chargers.filter(
      (c) => String(c.status || "").toLowerCase() === "decommissioned"
    ).length,
    missingCoordinates: visible.filter((c) => c.latitude == null || c.longitude == null).length,
  };
}
