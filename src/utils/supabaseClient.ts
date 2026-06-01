import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Supabase client for PostgreSQL / storage / realtime only — not Supabase Auth.
 * TODO: Use service role only on backend; web uses anon + RLS policies.
 */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env");
  }
  return supabase;
}
