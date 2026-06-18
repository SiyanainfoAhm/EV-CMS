/** Build per-charger OCPP 1.6J WebSocket URL from gateway REST base URL. */

const gatewayRestUrl = (import.meta.env.VITE_OCPP_GATEWAY_API_URL || "").replace(/\/$/, "");
const ocppWsPath = (import.meta.env.VITE_OCPP_WS_PATH || "/ocpp").replace(/\/$/, "");

export function buildOcppWebSocketUrl(chargePointId: string): string {
  const cpId = chargePointId.trim().toUpperCase();
  if (!gatewayRestUrl || !cpId) return "";

  const wsBase = gatewayRestUrl.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
  return `${wsBase}${ocppWsPath}/${encodeURIComponent(cpId)}`;
}

export function getOcppPathPattern(): string {
  return `${ocppWsPath}/{chargePointId}`;
}
