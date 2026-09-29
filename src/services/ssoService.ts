import type { AuthUser } from "@/types/auth";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapDbRoleToAuthRole } from "@/utils/rfpRoles";

const ISSUER = (import.meta.env.VITE_OIDC_ISSUER || "https://app2.dfccil.com").replace(/\/$/, "");
const CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID || "f51c3d26cd09487eb2350a9742b8af18";
const SCOPE = import.meta.env.VITE_OIDC_SCOPE || "openid profile";

const VERIFIER_KEY = "ev_cms_sso_verifier";
const STATE_KEY = "ev_cms_sso_state";
const NONCE_KEY = "ev_cms_sso_nonce";
const REDIRECT_KEY = "ev_cms_sso_redirect";

const AUTHORIZE_URL = `${ISSUER}/connect/authorize`;
const TOKEN_URL = `${ISSUER}/connect/token`;
const USERINFO_URL = `${ISSUER}/connect/userinfo`;
const JWKS_URL = `${ISSUER}/.well-known/openid-configuration/jwks`;
const END_SESSION_URL = `${ISSUER}/connect/endsession`;

const inflightByCode = new Map<string, Promise<SsoLoginResult>>();

export interface SsoLoginResult {
  success: boolean;
  error?: string;
  user?: AuthUser;
  idToken?: string;
  expiresAt?: string;
}

export function ssoRedirectUri(): string {
  return `${window.location.origin}/signin-oidc`;
}

export function ssoPostLogoutUri(): string {
  return window.location.origin;
}

export async function startSsoLogin(): Promise<void> {
  const verifier = randomString();
  const state = randomString();
  const nonce = randomString();
  const redirectUri = ssoRedirectUri();
  const challenge = await sha256Base64Url(verifier);

  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(NONCE_KEY, nonce);
  sessionStorage.setItem(REDIRECT_KEY, redirectUri);

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  window.location.assign(url.toString());
}

export function completeSsoLogin(search: string): Promise<SsoLoginResult> {
  const params = new URLSearchParams(search);
  const code = params.get("code") || "";
  if (!code) {
    return Promise.resolve({ success: false, error: params.get("error_description") || params.get("error") || "SSO login was cancelled." });
  }
  const existing = inflightByCode.get(code);
  if (existing) return existing;
  const pending = finishSsoLogin(params, code).finally(() => {
    inflightByCode.delete(code);
  });
  inflightByCode.set(code, pending);
  return pending;
}

export function redirectToSsoLogout(idToken: string | null): void {
  const url = new URL(END_SESSION_URL);
  url.searchParams.set("post_logout_redirect_uri", ssoPostLogoutUri());
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  window.location.assign(url.toString());
}

async function finishSsoLogin(params: URLSearchParams, code: string): Promise<SsoLoginResult> {
  const state = params.get("state") || "";
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const nonce = sessionStorage.getItem(NONCE_KEY);
  const redirectUri = sessionStorage.getItem(REDIRECT_KEY) || ssoRedirectUri();

  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(NONCE_KEY);
  sessionStorage.removeItem(REDIRECT_KEY);

  if (!expectedState || state !== expectedState || !verifier || !nonce) {
    return { success: false, error: "SSO login could not be verified. Start sign-in again." };
  }

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    id_token?: string;
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokenJson.id_token) {
    return {
      success: false,
      error: tokenJson.error_description || tokenJson.error || "DFCCIL SSO did not return an ID token.",
    };
  }

  let claims: Record<string, unknown>;
  try {
    claims = await verifyIdToken(tokenJson.id_token, nonce);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "ID token is not valid." };
  }

  let employeeCode = employeeCodeFromClaims(claims);
  if (!employeeCode && tokenJson.access_token) {
    const info = await fetchUserInfo(tokenJson.access_token);
    employeeCode = employeeCodeFromClaims(info);
    if (!claims.sub && typeof info.sub === "string") claims.sub = info.sub;
  }

  if (!employeeCode) {
    return { success: false, error: "SSO token did not include a UserId claim." };
  }

  const { data, error } = await requireSupabase().rpc("resolve_ev_user_for_sso", {
    p_employee_code: employeeCode,
    p_sso_sub: typeof claims.sub === "string" ? claims.sub : null,
  });

  if (error) {
    const missing = /resolve_ev_user_for_sso|schema cache|PGRST202/i.test(error.message);
    return {
      success: false,
      error: missing
        ? "SSO user lookup is not installed. Run supabase/sso_user_lookup.sql in the Supabase SQL Editor, then sign in again."
        : error.message,
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row?.id) {
    return { success: false, error: "User not registered in EV-CMS" };
  }

  const exp = Number(claims.exp);
  return {
    success: true,
    idToken: tokenJson.id_token,
    expiresAt: new Date(exp * 1000).toISOString(),
    user: {
      id: row.id as string,
      email: row.email as string,
      name: row.full_name as string,
      role: mapDbRoleToAuthRole(row.role as string),
      department: (row.department as string) ?? undefined,
      status: row.status as AuthUser["status"],
      phone: (row.phone as string) ?? undefined,
      avatarUrl: (row.avatar_url as string) ?? null,
      employeeId: (row.employee_id as string) ?? null,
    },
  };
}

function employeeCodeFromClaims(claims: Record<string, unknown>): string {
  for (const key of ["UserId", "username", "preferred_username"]) {
    const value = claims[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function fetchUserInfo(accessToken: string): Promise<Record<string, unknown>> {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return {};
  return (await res.json()) as Record<string, unknown>;
}

async function verifyIdToken(idToken: string, nonce: string): Promise<Record<string, unknown>> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid ID token.");
  const header = JSON.parse(decodeBase64Url(parts[0])) as { alg?: string; kid?: string };
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported ID token algorithm.");

  const jwksRes = await fetch(JWKS_URL);
  if (!jwksRes.ok) throw new Error("Could not load the SSO signing keys.");
  const jwks = (await jwksRes.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const jwk = jwks.keys?.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("SSO signing key was not found.");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    bytesFromBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw new Error("ID token signature is invalid.");

  const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
  if (payload.iss !== ISSUER) throw new Error("ID token issuer does not match DFCCIL SSO.");
  const audience = payload.aud;
  const audienceOk = audience === CLIENT_ID || (Array.isArray(audience) && audience.includes(CLIENT_ID));
  if (!audienceOk) throw new Error("ID token was not issued for EV-CMS.");
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) throw new Error("ID token has expired.");
  if (payload.nonce !== nonce) throw new Error("ID token nonce does not match this login.");
  return payload;
}

function randomString(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesFromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeBase64Url(value: string): string {
  return new TextDecoder().decode(bytesFromBase64Url(value));
}
