import { createSessionExpiresAt, isSessionExpired } from "../constants/authSession";
import { requireSupabase } from "../utils/supabaseClient";
import { clearStoredSession, loadStoredSession, saveStoredSession, type StoredSession } from "../utils/sessionStorage";
import type { User } from "../types";

let sessionToken: string | null = null;
let sessionUser: User | null = null;
let sessionExpiresAtIso: string | null = null;

function buildSession(user: User): StoredSession {
  return {
    token: `ev_mobile_${user.id}_${Date.now()}`,
    user,
    expiresAt: createSessionExpiresAt(),
  };
}

function applySession(session: StoredSession): void {
  sessionToken = session.token;
  sessionUser = session.user;
  sessionExpiresAtIso = session.expiresAt;
}

export async function restoreSession(): Promise<User | null> {
  try {
    const stored = await loadStoredSession();
    if (!stored) {
      sessionToken = null;
      sessionUser = null;
      sessionExpiresAtIso = null;
      return null;
    }
    if (isSessionExpired(stored.expiresAt)) {
      await clearStoredSession();
      sessionToken = null;
      sessionUser = null;
      sessionExpiresAtIso = null;
      return null;
    }
    applySession(stored);
    return stored.user;
  } catch (e) {
    console.error("[authService] restoreSession failed:", e);
    await clearStoredSession();
    sessionToken = null;
    sessionUser = null;
    sessionExpiresAtIso = null;
    return null;
  }
}

export async function login(email: string, password: string): Promise<{ success: boolean; user?: User; error?: string }> {
  if (!email.trim() || !password) {
    return { success: false, error: "Please enter email and password" };
  }

  const { data, error } = await requireSupabase().rpc("verify_ev_login", {
    p_email: email.trim(),
    p_password: password,
  });

  if (error) {
    const msg = error.message;
    if (msg.includes("ambiguous") || msg.includes("42702")) {
      return {
        success: false,
        error: "Login function needs update. Run supabase/fix_login.sql in Supabase SQL Editor.",
      };
    }
    return { success: false, error: msg };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { success: false, error: "Invalid email or password. Demo: dfccil123" };
  }

  const r = row as Record<string, unknown>;
  if (r.status !== "active") {
    return { success: false, error: "Your account is not active." };
  }

  let user: User = {
    id: r.id as string,
    name: r.full_name as string,
    email: r.email as string,
    role: r.role as string,
    department: (r.department as string) ?? undefined,
  };

  try {
    const profile = await refreshProfile(user.id);
    if (profile) user = profile;
  } catch {
    // profile RPC optional
  }

  const session = buildSession(user);
  applySession(session);
  await saveStoredSession(session);
  return { success: true, user };
}

export async function persistSessionUser(user: User): Promise<void> {
  const stored = await loadStoredSession();
  if (!stored) return;
  sessionUser = user;
  await saveStoredSession({ ...stored, user });
}

export async function refreshProfile(userId: string): Promise<User | null> {
  const { data, error } = await requireSupabase().rpc("get_ev_user_profile", { p_user_id: userId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    name: r.full_name as string,
    email: r.email as string,
    role: r.role as string,
    phone: (r.phone as string) ?? undefined,
    department: (r.department as string) ?? undefined,
    avatarUrl: (r.avatar_url as string) ?? null,
  };
}

export function getSessionUser(): User | null {
  return sessionUser;
}

export function requireUserId(): string {
  const id = sessionUser?.id;
  if (!id) throw new Error("Not signed in");
  return id;
}

export function isAuthenticated(): boolean {
  if (!sessionToken || !sessionUser) return false;
  if (sessionExpiresAtIso && isSessionExpired(sessionExpiresAtIso)) return false;
  return sessionToken.startsWith("ev_mobile_");
}

export async function logout(): Promise<void> {
  sessionToken = null;
  sessionUser = null;
  sessionExpiresAtIso = null;
  await clearStoredSession();
}
