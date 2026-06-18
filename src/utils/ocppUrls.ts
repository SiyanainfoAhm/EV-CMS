/** Build per-charger OCPP 1.6J WebSocket URL from gateway REST base URL. */

const ocppWsPath = (import.meta.env.VITE_OCPP_WS_PATH || "/ocpp").replace(/\/$/, "");

let runtimeGatewayUrl: string | null = null;
let configLoadPromise: Promise<void> | null = null;

function normalizeGatewayUrl(raw: string): string {
  const v = raw.trim().replace(/^["']|["']$/g, "").replace(/\/$/, "");
  if (!v) return "";
  if (/^wss:\/\//i.test(v)) return v.replace(/^wss:\/\//i, "https://");
  if (/^ws:\/\//i.test(v)) return v.replace(/^ws:\/\//i, "http://");
  return v;
}

const buildTimeGatewayUrl = normalizeGatewayUrl(import.meta.env.VITE_OCPP_GATEWAY_API_URL || "");

/** REST base URL for OCPP gateway (build-time env or runtime app-config.json). */
export function getGatewayRestUrl(): string {
  return normalizeGatewayUrl(runtimeGatewayUrl || buildTimeGatewayUrl);
}

export function isOcppGatewayConfigured(): boolean {
  return Boolean(getGatewayRestUrl());
}

/** Load /app-config.json when VITE_OCPP_GATEWAY_API_URL was not set at build (e.g. Vercel forgot redeploy). */
export async function loadOcppGatewayConfig(): Promise<void> {
  if (getGatewayRestUrl()) return;
  if (!configLoadPromise) {
    configLoadPromise = (async () => {
      try {
        const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
        const res = await fetch(`${base}app-config.json`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { ocppGatewayApiUrl?: string };
        const url = normalizeGatewayUrl(data.ocppGatewayApiUrl || "");
        if (url) runtimeGatewayUrl = url;
      } catch {
        /* optional fallback */
      }
    })();
  }
  await configLoadPromise;
}

export function buildOcppWebSocketUrl(chargePointId: string): string {
  const gatewayRestUrl = getGatewayRestUrl();
  const cpId = chargePointId.trim().toUpperCase();
  if (!gatewayRestUrl || !cpId) return "";

  const wsBase = gatewayRestUrl.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
  return `${wsBase}${ocppWsPath}/${encodeURIComponent(cpId)}`;
}

export function getOcppPathPattern(): string {
  return `${ocppWsPath}/{chargePointId}`;
}
