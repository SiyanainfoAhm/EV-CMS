/**
 * OCPP 1.6J integration placeholders.
 * Actual implementation will call the Node.js OCPP WebSocket Gateway REST APIs.
 */

const gatewayUrl = import.meta.env.VITE_OCPP_GATEWAY_API_URL || "";

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
  // TODO: POST ${gatewayUrl}/ocpp/remote-start
  console.warn("[ocppService] remoteStartTransaction placeholder", gatewayUrl, params);
  return { accepted: true };
}

export async function remoteStopTransaction(params: RemoteStopParams): Promise<{ accepted: boolean }> {
  // TODO: POST ${gatewayUrl}/ocpp/remote-stop
  console.warn("[ocppService] remoteStopTransaction placeholder", gatewayUrl, params);
  return { accepted: true };
}

export async function resetCharger(chargePointId: string, type: "Hard" | "Soft" = "Soft"): Promise<void> {
  // TODO: POST ${gatewayUrl}/ocpp/reset
  console.warn("[ocppService] resetCharger placeholder", chargePointId, type);
}

export async function getChargerStatus(chargePointId: string): Promise<Record<string, unknown>> {
  // TODO: GET ${gatewayUrl}/ocpp/chargers/${chargePointId}/status
  console.warn("[ocppService] getChargerStatus placeholder", chargePointId);
  return { status: "Unknown" };
}

export async function getConnectorStatus(
  chargePointId: string,
  connectorId: number
): Promise<Record<string, unknown>> {
  // TODO: GET ${gatewayUrl}/ocpp/chargers/${chargePointId}/connectors/${connectorId}
  console.warn("[ocppService] getConnectorStatus placeholder", chargePointId, connectorId);
  return { status: "Unknown" };
}

export async function sendChangeConfiguration(
  chargePointId: string,
  key: string,
  value: string
): Promise<void> {
  // TODO: POST ${gatewayUrl}/ocpp/change-configuration
  console.warn("[ocppService] sendChangeConfiguration placeholder", chargePointId, key, value);
}

export async function triggerMeterValues(chargePointId: string, connectorId?: number): Promise<void> {
  // TODO: POST ${gatewayUrl}/ocpp/trigger-meter-values
  console.warn("[ocppService] triggerMeterValues placeholder", chargePointId, connectorId);
}
