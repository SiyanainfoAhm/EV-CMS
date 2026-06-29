/** OCPP 1.6J ChargePointStatus values for connector (gun) display in web admin. */
export const OCPP_CONNECTOR_STATUSES = [
  "Available",
  "Preparing",
  "Charging",
  "SuspendedEVSE",
  "SuspendedEV",
  "Finishing",
  "Reserved",
  "Unavailable",
  "Faulted",
] as const;

export type OcppConnectorStatus = (typeof OCPP_CONNECTOR_STATUSES)[number];

const STATUS_SET = new Set<string>(OCPP_CONNECTOR_STATUSES);

/** Human-readable gun status for admin UI. */
export function connectorStatusLabel(status: string): string {
  switch (status) {
    case "SuspendedEVSE":
      return "Paused (charger)";
    case "SuspendedEV":
      return "Paused (EV)";
    default:
      return status || "Unknown";
  }
}

export function normalizeConnectorStatus(status: string | null | undefined): string {
  const s = (status ?? "").trim();
  if (STATUS_SET.has(s)) return s;
  if (!s) return "Unavailable";
  return s;
}

export function connectorStatusBadgeClass(status: string): string {
  switch (normalizeConnectorStatus(status)) {
    case "Charging":
      return "bg-emerald-100 text-emerald-700";
    case "Preparing":
      return "bg-blue-100 text-blue-700";
    case "Finishing":
      return "bg-amber-100 text-amber-700";
    case "Faulted":
      return "bg-red-100 text-red-700";
    case "SuspendedEVSE":
    case "SuspendedEV":
      return "bg-orange-100 text-orange-700";
    case "Reserved":
      return "bg-violet-100 text-violet-700";
    case "Unavailable":
      return "bg-gray-100 text-gray-400";
    case "Available":
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export function isConnectorCharging(status: string): boolean {
  return normalizeConnectorStatus(status) === "Charging";
}

/** Remote Start allowed when gun is idle or car is plugged (Preparing). */
export function canRemoteStartConnector(status: string): boolean {
  const s = normalizeConnectorStatus(status);
  return s === "Available" || s === "Preparing";
}

export function isConnectorFaulted(status: string): boolean {
  return normalizeConnectorStatus(status) === "Faulted";
}
