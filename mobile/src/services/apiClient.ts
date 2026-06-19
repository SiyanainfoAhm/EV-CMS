import { paymentConfig } from "../config/paymentConfig";
import { getSessionMeta, requireUserId } from "./authService";

export class ApiNotConfiguredError extends Error {
  constructor() {
    super("API_NOT_CONFIGURED");
    this.name = "ApiNotConfiguredError";
  }
}

export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-User-Id": requireUserId(),
  };
  const session = getSessionMeta();
  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  return headers;
}

function resolveUrl(path: string): string {
  if (!paymentConfig.apiBaseUrl) {
    throw new ApiNotConfiguredError();
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (paymentConfig.apiBaseUrl.endsWith("/api")) {
    return `${paymentConfig.apiBaseUrl}${normalizedPath}`;
  }
  return `${paymentConfig.apiBaseUrl}/api${normalizedPath}`;
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    return body.message || body.error || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(resolveUrl(path), {
    method: "GET",
    headers: buildHeaders(),
  });
  if (!res.ok) {
    throw new ApiRequestError(await parseErrorMessage(res), res.status);
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(resolveUrl(path), {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiRequestError(await parseErrorMessage(res), res.status);
  }
  return (await res.json()) as T;
}
