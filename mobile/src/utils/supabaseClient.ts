import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error("Configure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY");
  return supabase;
}
