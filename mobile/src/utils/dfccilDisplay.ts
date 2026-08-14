import type { Charger, ChargerConnector } from "../types";
import { isSimulationEnabled } from "./simulationMode";

export type ChargerNameFields = {
  displayName?: string | null;
  name?: string | null;
  chargePointId?: string | null;
};

/**
 * Single source of truth for charger labels (mobile + web parity).
 * display_name → name → charge_point_id → Unknown Charger
 * Never invents "DFCCIL AC Charger - N" from array index.
 */
export function getChargerDisplayName(charger: ChargerNameFields | null | undefined): string {
  const display = String(charger?.displayName ?? "").trim();
  if (display) return display;
  const name = String(charger?.name ?? "").trim();
  if (name) return name;
  const cpId = String(charger?.chargePointId ?? "").trim();
  if (cpId) return cpId;
  return "Unknown Charger";
}

/** @deprecated Use getChargerDisplayName — kept so old imports fail loudly if misused. */
export function dfccilChargerDisplayName(
  charger: ChargerNameFields,
  _indexAmongKind?: number
): string {
  return getChargerDisplayName(charger);
}

/** Stable AC/DC classification from charger_type / name / charge_point_id. */
export function isDcCharger(
  charger: Pick<Charger, "type" | "name" | "chargePointId"> & { displayName?: string | null }
): boolean {
  const blob = `${charger.type} ${charger.name} ${charger.displayName ?? ""} ${charger.chargePointId}`.toLowerCase();
  return /(^|[^a-z])dc([^a-z]|$)/.test(blob) || blob.includes("fast");
}

export function chargerKindLabel(
  charger: Pick<Charger, "type" | "name" | "chargePointId"> & { displayName?: string | null }
): "AC" | "DC" {
  return isDcCharger(charger) ? "DC" : "AC";
}

/** Plug type rule: AC → Type-2, DC → CCS-2 */
export function plugTypeForCharger(
  charger: Pick<Charger, "type" | "name" | "chargePointId">
): string {
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

/** Sort for stable lists: AC then DC, then charge_point_id. */
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

export function formatPowerLine(
  charger: Pick<Charger, "type" | "name" | "chargePointId" | "maxPowerKw">
): string {
  const kind = chargerKindLabel(charger);
  const kw = Number(charger.maxPowerKw);
  if (Number.isFinite(kw) && kw > 0) {
    const display = Number.isInteger(kw) ? String(kw) : kw.toFixed(1);
    return `${kind} | ${display} kW`;
  }
  return kind;
}

export function formatUptoPowerKw(kw: number | null | undefined, fallback?: number): string {
  const n = Number(kw);
  if (Number.isFinite(n) && n > 0) {
    const display = Number.isInteger(n) ? String(n) : n.toFixed(1);
    return `Upto ${display} kW`;
  }
  if (fallback != null && Number.isFinite(fallback) && fallback > 0) {
    const display = Number.isInteger(fallback) ? String(fallback) : fallback.toFixed(1);
    return `Upto ${display} kW`;
  }
  return "Upto — kW";
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

export function stationTitleFromChargers(chargers: Charger[]): string {
  if (chargers.length === 0) return "Charging Station";
  const loc = String(chargers[0].location || "").trim();
  if (loc) return loc;
  return "Charging Station";
}

export function logChargerFilter(chargers: Charger[], visible: Charger[]): void {
  if (typeof __DEV__ !== "undefined" && !__DEV__) return;
  const simulatedHidden = chargers.filter((c) => c.isSimulated && !isSimulationEnabled()).length;
  const decommissionedHidden = chargers.filter(
    (c) => String(c.status || "").toLowerCase() === "decommissioned"
  ).length;
  console.log("[charger-filter]", {
    total: chargers.length,
    visible: visible.length,
    acVisible: visible.filter((c) => !isDcCharger(c)).length,
    dcVisible: visible.filter((c) => isDcCharger(c)).length,
    simulatedHidden,
    decommissionedHidden,
  });
}

export function summarizeVisibleChargers(chargers: Charger[]): {
  totalActive: number;
  activeAc: number;
  activeDc: number;
  missingCoordinates: number;
} {
  const visible = chargers.filter(isVisibleFleetCharger);
  return {
    totalActive: visible.length,
    activeAc: visible.filter((c) => !isDcCharger(c)).length,
    activeDc: visible.filter((c) => isDcCharger(c)).length,
    missingCoordinates: visible.filter((c) => c.latitude == null || c.longitude == null).length,
  };
}
