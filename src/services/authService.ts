import type { AuthSession, AuthUser, LoginCredentials, LoginResult, UserRole } from "@/types/auth";
import { sessionExpiresAt, isSessionExpired } from "@/constants/authSession";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapDbRoleToAuthRole } from "@/utils/supabaseMappers";

const SESSION_STORAGE_KEY = "ev_cms_session_token";
const USER_STORAGE_KEY = "ev_cms_session_user";
const EXPIRES_STORAGE_KEY = "ev_cms_session_expires";

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function buildSession(user: AuthUser): AuthSession {
  return {
    token: `ev_jwt_${user.id}_${Date.now()}`,
    user,
    expiresAt: sessionExpiresAt(),
  };
}

export function getStoredSession(): AuthSession | null {
  if (!canUseStorage()) return null;
  try {
    const token = localStorage.getItem(SESSION_STORAGE_KEY);
    const userJson = localStorage.getItem(USER_STORAGE_KEY);
    if (!token || !userJson || !token.startsWith("ev_jwt_")) return null;

    const expiresAt = localStorage.getItem(EXPIRES_STORAGE_KEY) || "";
    if (isSessionExpired(expiresAt)) return null;

    const user = JSON.parse(userJson) as AuthUser;
    if (!user?.id) return null;

    return { token, user, expiresAt };
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
  } catch {
    /* ignore */
  }
}

export function validateToken(token: string | null): boolean {
  if (!token || !token.startsWith("ev_jwt_")) return false;
  const session = getStoredSession();
  return !!session && session.token === token;
}

async function verifyLoginAgainstDb(
  email: string,
  password: string
): Promise<{ user: AuthUser | null; rpcError?: string }> {
  const { data, error } = await requireSupabase().rpc("verify_ev_login", {
    p_email: email.trim(),
    p_password: password,
  });

  if (error) {
    console.error("[authService] verify_ev_login failed:", error.message, error);
    return { user: null, rpcError: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { user: null };

  const r = row as Record<string, unknown>;
  return {
    user: {
      id: r.id as string,
      email: r.email as string,
      name: r.full_name as string,
      role: mapDbRoleToAuthRole(r.role as string),
      department: (r.department as string) ?? undefined,
      status: r.status as AuthUser["status"],
      phone: (r.phone as string) ?? undefined,
      avatarUrl: (r.avatar_url as string) ?? null,
      employeeId: (r.employee_id as string) ?? null,
    },
  };
}

export async function login(credentials: LoginCredentials): Promise<LoginResult> {
  const { email, password } = credentials;

  if (!email || !password) {
    return { success: false, error: "Please enter both email and password" };
  }

  try {
    const { user, rpcError } = await verifyLoginAgainstDb(email, password);

    if (rpcError) {
      if (rpcError.includes("ambiguous") || rpcError.includes("42702")) {
        return {
          success: false,
          error:
            "Login database function needs an update. Run supabase/fix_login.sql in your Supabase SQL Editor, then try again.",
        };
      }
      return {
        success: false,
        error: `Login service error: ${rpcError}. Run supabase/fix_login.sql if this persists.`,
      };
    }

    if (!user) {
      return {
        success: false,
        error:
          "Invalid email or password. Demo password for seeded users is: dfccil123",
      };
    }

    if (user.status !== "active") {
      return { success: false, error: "Your account is not active." };
    }

    const session = buildSession(user);
    persistSession(session);
    return { success: true, session };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Login failed";
    if (message.includes("Supabase is not configured")) {
      return { success: false, error: message };
    }
    return {
      success: false,
      error:
        "Cannot reach database. Run supabase/schema.sql, rls.sql, and seed.sql in your Supabase project.",
    };
  }
}

export async function logout(): Promise<void> {
  clearSession();
}

export function getCurrentUser(): AuthUser | null {
  return getStoredSession()?.user ?? null;
}

export function hasRole(user: AuthUser | null, allowed: UserRole[]): boolean {
  if (!user) return false;
  return allowed.includes(user.role);
}
