import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AuthSession, AuthUser, LoginCredentials, UserRole } from "@/types/auth";
import * as authService from "@/services/authService";
import * as profileService from "@/services/profileService";

interface AuthContextValue {
  user: AuthUser | null;
  session: AuthSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateSessionUser: (user: AuthUser) => void;
  hasRole: (roles: UserRole[]) => boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

export function useAuthState(): AuthContextValue {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = authService.getStoredSession();
      if (stored && authService.validateToken(stored.token)) {
        setSession(stored);
      } else {
        authService.clearSession();
        setSession(null);
      }
    } catch {
      authService.clearSession();
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    const result = await authService.login(credentials);
    if (result.success && result.session) {
      setSession(result.session);
      return { success: true };
    }
    return { success: false, error: result.error };
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setSession(null);
  }, []);

  const hasRole = useCallback(
    (roles: UserRole[]) => authService.hasRole(session?.user ?? null, roles),
    [session]
  );

  const updateSessionUser = useCallback((user: AuthUser) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, user };
      authService.persistSession(next);
      return next;
    });
  }, []);

  const refreshUser = useCallback(async () => {
    const id = session?.user?.id;
    if (!id) return;
    const profile = await profileService.getProfile(id);
    updateSessionUser(profileService.profileToAuthFields(profile));
  }, [session?.user?.id, updateSessionUser]);

  return useMemo(
    () => ({
      user: session?.user ?? null,
      session,
      isAuthenticated: !!session && authService.validateToken(session.token),
      isLoading,
      login,
      logout,
      refreshUser,
      updateSessionUser,
      hasRole,
    }),
    [session, isLoading, login, logout, refreshUser, updateSessionUser, hasRole]
  );
}
