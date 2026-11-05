import { AuthRequest, ResponseType, CodeChallengeMethod, fetchDiscoveryAsync } from "expo-auth-session";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { backendEndpoint } from "../utils/ssoTransport";
import { ssoConfig } from "../config/ssoConfig";
import type { StoredSession } from "../utils/sessionStorage";

WebBrowser.maybeCompleteAuthSession();
const SESSION_KEY = "ev_cms_sso_session";

function requireBackendUrl(): void {
  let url: URL;
  try { url = new URL(ssoConfig.backendUrl); } catch { throw new Error("DFCCIL SSO backend is not configured."); }
  const localDevelopment = __DEV__ && url.protocol === "http:" &&
    ["10.0.2.2", "127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !localDevelopment) throw new Error("DFCCIL SSO requires an HTTPS backend.");
}

async function backend(action: string, body: Record<string, string> = {}, token?: string): Promise<StoredSession> {
  requireBackendUrl();
  const response = await fetch(backendEndpoint("sso"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...body }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "SSO sign-in failed. Please try again.");
  if (typeof result.token !== "string" || !result.token || !result.user?.id ||
      typeof result.expiresAt !== "string" || !Number.isFinite(Date.parse(result.expiresAt)) ||
      Date.parse(result.expiresAt) <= Date.now()) {
    throw new Error("Invalid SSO session response.");
  }
  return result as StoredSession;
}

export async function loginWithSso(): Promise<StoredSession | null> {
  if (!ssoConfig.enabled || Platform.OS === "web") throw new Error("DFCCIL SSO is not enabled for this app.");
  requireBackendUrl();
  await retryPendingRevocations();
  const discovery = await fetchDiscoveryAsync(ssoConfig.issuer);
  const nonce = Crypto.randomUUID();
  const request = new AuthRequest({
    clientId: ssoConfig.clientId,
    redirectUri: ssoConfig.redirectUri,
    scopes: ["openid"],
    responseType: ResponseType.Code,
    usePKCE: true,
    codeChallengeMethod: CodeChallengeMethod.S256,
    extraParams: { nonce },
  });
  await request.makeAuthUrlAsync(discovery);
  const result = await request.promptAsync(discovery);
  if (result.type === "cancel" || result.type === "dismiss") return null;
  if (result.type !== "success" || !result.params.code || !request.codeVerifier) {
    if (result.type === "error") {
      throw new Error(`DFCCIL sign-in was rejected (${result.error?.code || "authorization_error"}). Check callback registration and client permissions.`);
    }
    throw new Error("DFCCIL sign-in was not completed. Please try again.");
  }
  const session = await backend("exchange", {
    code: result.params.code,
    codeVerifier: request.codeVerifier,
    nonce,
    redirectUri: ssoConfig.redirectUri,
  });
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function restoreSsoSession(): Promise<StoredSession | null> {
  if (Platform.OS === "web") return null;
  await retryPendingRevocations();
  const stored = await SecureStore.getItemAsync(SESSION_KEY);
  if (!stored) return null;
  const session = JSON.parse(stored) as StoredSession;
  if (!session.token || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
    await clearSsoSession();
    return null;
  }
  // Re-check the signature, user status and role on the backend on every restore.
  return backend("session", {}, session.token);
}

export async function clearSsoSession(): Promise<void> {
  if (Platform.OS !== "web") await SecureStore.deleteItemAsync(SESSION_KEY);
}

const REVOCATIONS_KEY = "ev_cms_sso_pending_revocations";
type PendingRevocation = { token: string; expiresAt: string; all: boolean };
async function pendingRevocations(): Promise<PendingRevocation[]> {
  const value = await SecureStore.getItemAsync(REVOCATIONS_KEY);
  try { return value ? JSON.parse(value) : []; } catch { return []; }
}
export async function retryPendingRevocations(): Promise<void> {
  if (Platform.OS === "web") return;
  const remaining: PendingRevocation[] = [];
  for (const entry of await pendingRevocations()) {
    if (Date.parse(entry.expiresAt) <= Date.now()) continue;
    try {
      const response = await fetch(backendEndpoint("sso"), {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${entry.token}` },
        body: JSON.stringify({ action: entry.all ? "logout-all" : "logout" }), signal: AbortSignal.timeout(5000),
      });
      if (!response.ok && response.status !== 401) remaining.push(entry);
    } catch { remaining.push(entry); }
  }
  if (remaining.length) await SecureStore.setItemAsync(REVOCATIONS_KEY, JSON.stringify(remaining));
  else await SecureStore.deleteItemAsync(REVOCATIONS_KEY);
}
export async function logoutSso(all = false, providerLogout = true): Promise<void> {
  if (Platform.OS === "web") return;
  const stored = await SecureStore.getItemAsync(SESSION_KEY);
  if (!stored) return;
  const session = JSON.parse(stored) as StoredSession;
  const pending = await pendingRevocations();
  if (!pending.some(entry => entry.token === session.token)) {
    pending.push({ token: session.token, expiresAt: session.expiresAt, all });
    await SecureStore.setItemAsync(REVOCATIONS_KEY, JSON.stringify(pending));
  }
  // Offline logout always clears the device. Revocation is retried on the next connection.
  await retryPendingRevocations();
  if (providerLogout && session.providerLogoutUrl && session.providerLogoutRedirectUri) {
    const logout = new URL(session.providerLogoutUrl);
    if (logout.origin !== ssoConfig.issuer || logout.pathname !== "/connect/endsession" || session.providerLogoutRedirectUri !== ssoConfig.redirectUri) {
      throw new Error("Unexpected provider logout configuration.");
    }
    await WebBrowser.openAuthSessionAsync(session.providerLogoutUrl, session.providerLogoutRedirectUri);
  }
}
