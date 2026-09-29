import type { AuthSession, AuthUser, LoginResult, UserRole } from "@/types/auth";
import { isSessionExpired } from "@/constants/authSession";
import { canAccessWebAdmin, WEB_USER_DENIED_MESSAGE } from "@/utils/rfpRoles";
import { redirectToSsoLogout } from "@/services/ssoService";

const SESSION_STORAGE_KEY = "ev_cms_session_token";
const USER_STORAGE_KEY = "ev_cms_session_user";
const EXPIRES_STORAGE_KEY = "ev_cms_session_expires";
const ID_TOKEN_KEY = "ev_cms_sso_id_token";

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function getStoredSession(): AuthSession | null {
  if (!canUseStorage()) return null;
  try {
    const token = localStorage.getItem(SESSION_STORAGE_KEY);
    const userJson = localStorage.getItem(USER_STORAGE_KEY);
    const idToken = localStorage.getItem(ID_TOKEN_KEY);
    if (!token || !userJson || !idToken || !token.startsWith("sso_")) return null;

    const expiresAt = localStorage.getItem(EXPIRES_STORAGE_KEY) || "";
    if (isSessionExpired(expiresAt)) return null;

    const user = JSON.parse(userJson) as AuthUser;
    if (!user?.id) return null;

    return { token, user, expiresAt, idToken };
  } catch {
    return null;
  }
}

export function persistSession(session: AuthSession): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, session.token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(session.user));
    localStorage.setItem(EXPIRES_STORAGE_KEY, session.expiresAt);
    localStorage.setItem(ID_TOKEN_KEY, session.idToken);
  } catch (e) {
    console.error("[authService] Failed to persist session:", e);
  }
}

export function clearSession(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(EXPIRES_STORAGE_KEY);
    localStorage.removeItem(ID_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function validateToken(token: string | null): boolean {
  if (!token || !token.startsWith("sso_")) return false;
  const session = getStoredSession();
  return !!session && session.token === token;
}

export function establishSsoSession(user: AuthUser, idToken: string, expiresAt: string): LoginResult {
  if (user.status !== "active") {
    return { success: false, error: "Your account is not active." };
  }
  if (!canAccessWebAdmin(user.role)) {
    return { success: false, error: WEB_USER_DENIED_MESSAGE };
  }
  const session: AuthSession = {
    token: `sso_${user.id}_${Date.now()}`,
    user,
    expiresAt,
    idToken,
  };
  persistSession(session);
  return { success: true, session };
}

export async function logout(): Promise<void> {
  const idToken = canUseStorage() ? localStorage.getItem(ID_TOKEN_KEY) : null;
  const expiresAt = canUseStorage() ? localStorage.getItem(EXPIRES_STORAGE_KEY) : null;
  const canEndSession = !!idToken && !isSessionExpired(expiresAt);
  clearSession();
  if (canEndSession) redirectToSsoLogout(idToken);
}

export function getCurrentUser(): AuthUser | null {
  return getStoredSession()?.user ?? null;
}

export function hasRole(user: AuthUser | null, allowed: UserRole[]): boolean {
  if (!user) return false;
  return allowed.includes(user.role);
}
