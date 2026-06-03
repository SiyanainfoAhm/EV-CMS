import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as authService from "../services/authService";
import type { User } from "../types";

interface AuthContextValue {
  ready: boolean;
  user: User | null;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    authService.restoreSession().then((restored) => {
      setUser(restored);
      setReady(true);
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await authService.login(email, password);
    if (result.success && result.user) {
      setUser(result.user);
      return { success: true };
    }
    return { success: false, error: result.error };
  }, []);

  const signOut = useCallback(async () => {
    await authService.logout();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const current = authService.getSessionUser();
    if (!current) {
      setUser(null);
      return;
    }
    const profile = await authService.refreshProfile(current.id);
    const next = profile ?? current;
    setUser(next);
    await authService.persistSessionUser(next);
  }, []);

  const value = useMemo(
    () => ({
      ready,
      user,
      isAuthenticated: !!user && authService.isAuthenticated(),
      signIn,
      signOut,
      refreshUser,
    }),
    [ready, user, signIn, signOut, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
