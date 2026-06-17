/** Build per-charger OCPP 1.6J WebSocket URL from gateway REST base URL. */

const gatewayApiUrl = (import.meta.env.VITE_OCPP_GATEWAY_API_URL || "").replace(/\/$/, "");
const ocppWsPath = (import.meta.env.VITE_OCPP_WS_PATH || "/ocpp").replace(/\/$/, "");

export function buildOcppWebSocketUrl(chargePointId: string): string {
  const cpId = chargePointId.trim().toUpperCase();
  if (!gatewayApiUrl || !cpId) return "";

  try {
    const url = new URL(gatewayApiUrl);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${url.host}${ocppWsPath}/${encodeURIComponent(cpId)}`;
  } catch {
    return "";
  }
}

export function getOcppGatewayHost(): string {
  if (!gatewayApiUrl) return "";
  try {
    return new URL(gatewayApiUrl).host;
  } catch {
    return "";
  }
}
