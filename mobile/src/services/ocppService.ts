/** OCPP gateway REST client — same RemoteStart/Stop path as web admin. */

const PRODUCTION_GATEWAY_URL = "https://ev-cms-ocpp-dfccil.fly.dev";

let runtimeGatewayUrl: string | null = null;

function normalizeGatewayUrl(raw: string): string {
  const v = String(raw || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/$/, "");
  if (!v) return "";
  if (/^wss:\/\//i.test(v)) return v.replace(/^wss:\/\//i, "https://");
  if (/^ws:\/\//i.test(v)) return v.replace(/^ws:\/\//i, "http://");
  return v;
}

function envGatewayUrl(): string {
  return normalizeGatewayUrl(process.env.EXPO_PUBLIC_OCPP_GATEWAY_API_URL || "");
}

function gatewayBaseUrl(): string {
  return normalizeGatewayUrl(runtimeGatewayUrl || envGatewayUrl() || PRODUCTION_GATEWAY_URL);
}

/** Optional override (e.g. from remote config). */
export function setOcppGatewayUrl(url: string): void {
  runtimeGatewayUrl = normalizeGatewayUrl(url) || null;
}

export function getOcppGatewayUrl(): string {
  return gatewayBaseUrl();
}

export function isOcppGatewayConfigured(): boolean {
  return Boolean(gatewayBaseUrl());
}

export class OcppGatewayError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "OcppGatewayError";
    this.status = status;
  }
}

async function gatewayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = gatewayBaseUrl();
  if (!base) {
    throw new OcppGatewayError("OCPP gateway URL is not configured");
  }
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; accepted?: boolean };
  if (!res.ok) {
    throw new OcppGatewayError(body.error ?? `Gateway error ${res.status}`, res.status);
  }
  return body;
}

export async function remoteStartTransaction(params: {
  chargePointId: string;
  connectorId: number;
  idTag: string;
  bypassRfid?: boolean;
  userId?: string;
  prepaidPaid?: boolean;
  paymentId?: string;
  sessionId?: string;
}): Promise<{ accepted: boolean }> {
  const result = await gatewayFetch<{ accepted: boolean }>("/ocpp/remote-start", {
    method: "POST",
    body: JSON.stringify({
      chargePointId: params.chargePointId,
      connectorId: params.connectorId,
      idTag: params.idTag,
      bypassRfid: Boolean(params.bypassRfid),
      userId: params.userId,
      prepaidPaid: params.prepaidPaid,
      paymentId: params.paymentId,
      sessionId: params.sessionId,
    }),
  });
  return { accepted: Boolean(result.accepted) };
}

export async function remoteStopTransaction(params: {
  chargePointId: string;
  transactionId: number;
  bypassRfid?: boolean;
}): Promise<{ accepted: boolean }> {
  const result = await gatewayFetch<{ accepted: boolean }>("/ocpp/remote-stop", {
    method: "POST",
    body: JSON.stringify({
      chargePointId: params.chargePointId,
      transactionId: params.transactionId,
      bypassRfid: Boolean(params.bypassRfid),
    }),
  });
  return { accepted: Boolean(result.accepted) };
}
