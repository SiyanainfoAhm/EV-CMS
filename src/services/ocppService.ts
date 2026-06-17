/**
 * OCPP 1.6J client — calls the Node.js OCPP gateway REST API.
 */

import { buildOcppWebSocketUrl } from "@/utils/ocppUrls";

const gatewayUrl = (import.meta.env.VITE_OCPP_GATEWAY_API_URL || "").replace(/\/$/, "");

export class OcppGatewayError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "OcppGatewayError";
    this.status = status;
  }
}

async function gatewayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!gatewayUrl) {
    throw new OcppGatewayError("VITE_OCPP_GATEWAY_API_URL is not configured");
  }
  const res = await fetch(`${gatewayUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new OcppGatewayError(body.error ?? `Gateway error ${res.status}`, res.status);
  }
  return body;
}

export interface RemoteStartParams {
  chargePointId: string;
  connectorId: number;
  idTag: string;
}

export interface RemoteStopParams {
  chargePointId: string;
  transactionId: number;
}

export async function remoteStartTransaction(params: RemoteStartParams): Promise<{ accepted: boolean }> {
  const result = await gatewayFetch<{ accepted: boolean }>("/ocpp/remote-start", {
    method: "POST",
    body: JSON.stringify(params),
  });
  return { accepted: Boolean(result.accepted) };
}

export async function remoteStopTransaction(params: RemoteStopParams): Promise<{ accepted: boolean }> {
  const result = await gatewayFetch<{ accepted: boolean }>("/ocpp/remote-stop", {
    method: "POST",
    body: JSON.stringify(params),
  });
  return { accepted: Boolean(result.accepted) };
}

export async function resetCharger(chargePointId: string, type: "Hard" | "Soft" = "Soft"): Promise<void> {
  const result = await gatewayFetch<{ accepted: boolean }>("/ocpp/reset", {
    method: "POST",
    body: JSON.stringify({ chargePointId, type }),
  });
  if (!result.accepted) {
    throw new OcppGatewayError("Charger rejected reset command");
  }
}

export async function unlockConnector(chargePointId: string, connectorId: number): Promise<{ accepted: boolean }> {
  const result = await gatewayFetch<{ accepted: boolean }>("/ocpp/unlock", {
    method: "POST",
    body: JSON.stringify({ chargePointId, connectorId }),
  });
  return { accepted: Boolean(result.accepted) };
}

export async function getChargerStatus(chargePointId: string): Promise<Record<string, unknown>> {
  return gatewayFetch<Record<string, unknown>>(`/ocpp/chargers/${encodeURIComponent(chargePointId)}/status`);
}

export async function getConnectorStatus(
  chargePointId: string,
  connectorId: number
): Promise<Record<string, unknown>> {
  return gatewayFetch<Record<string, unknown>>(
    `/ocpp/chargers/${encodeURIComponent(chargePointId)}/connectors/${connectorId}`
  );
}

export async function sendChangeConfiguration(
  chargePointId: string,
  key: string,
  value: string
): Promise<void> {
  const result = await gatewayFetch<{ accepted: boolean }>("/ocpp/change-configuration", {
    method: "POST",
    body: JSON.stringify({ chargePointId, key, value }),
  });
  if (!result.accepted) {
    throw new OcppGatewayError("ChangeConfiguration rejected by charger");
  }
}

export async function triggerMeterValues(chargePointId: string, connectorId?: number): Promise<void> {
  const result = await gatewayFetch<{ accepted: boolean }>("/ocpp/trigger-meter-values", {
    method: "POST",
    body: JSON.stringify({ chargePointId, connectorId }),
  });
  if (!result.accepted) {
    throw new OcppGatewayError("TriggerMessage rejected by charger");
  }
}

export async function updateFirmware(
  chargePointId: string,
  location: string,
  retrieveDate?: string
): Promise<{ accepted: boolean }> {
  const result = await gatewayFetch<{ accepted: boolean }>("/ocpp/update-firmware", {
    method: "POST",
    body: JSON.stringify({ chargePointId, location, retrieveDate }),
  });
  return { accepted: Boolean(result.accepted) };
}

export interface FleetChargerStatus {
  chargePointId: string;
  name: string;
  ocppConnected: boolean;
  ocppWebSocketUrl: string;
}

export interface OcppFleetResponse {
  total: number;
  connectedCount: number;
  ocppPathPattern: string;
  chargers: FleetChargerStatus[];
}

/** Live OCPP connection map for all registered chargers (12+ — no hardcoded IDs). */
export async function getOcppFleet(): Promise<OcppFleetResponse> {
  if (!gatewayUrl) {
    return { total: 0, connectedCount: 0, ocppPathPattern: "/ocpp/{chargePointId}", chargers: [] };
  }
  try {
    const data = await gatewayFetch<{
      total: number;
      connectedCount: number;
      ocppWsPathPattern: string;
      chargers: { chargePointId: string; name: string; ocppConnected: boolean }[];
    }>("/ocpp/fleet");
    return {
      total: data.total,
      connectedCount: data.connectedCount,
      ocppPathPattern: data.ocppWsPathPattern,
      chargers: data.chargers.map((c) => ({
        chargePointId: c.chargePointId,
        name: c.name,
        ocppConnected: c.ocppConnected,
        ocppWebSocketUrl: buildOcppWebSocketUrl(c.chargePointId),
      })),
    };
  } catch {
    return { total: 0, connectedCount: 0, ocppPathPattern: "/ocpp/{chargePointId}", chargers: [] };
  }
}
