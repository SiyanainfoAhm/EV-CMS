import { requireSupabase } from "../utils/supabaseClient";
import type { User } from "../types";

let sessionToken: string | null = null;
let sessionUser: User | null = null;

export async function login(email: string, password: string): Promise<{ success: boolean; user?: User; error?: string }> {
  const { data, error } = await requireSupabase().rpc("verify_ev_login", {
    p_email: email,
    p_password: password,
  });

  if (error) return { success: false, error: error.message };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { success: false, error: "Invalid credentials" };

  const user: User = {
    id: row.id,
    name: row.full_name,
    email: row.email,
    role: row.role,
  };
  sessionToken = `mobile_${Date.now()}`;
  sessionUser = user;
  return { success: true, user };
}

export function getSessionUser(): User | null {
  return sessionUser;
}

export function isAuthenticated(): boolean {
  return !!sessionToken && !!sessionUser;
}

export function logout(): void {
  sessionToken = null;
  sessionUser = null;
}
