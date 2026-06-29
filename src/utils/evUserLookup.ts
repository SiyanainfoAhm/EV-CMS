import { requireSupabase } from "@/utils/supabaseClient";

export type EvUserLookup = Map<string, { full_name: string; email: string }>;

/** Web admin uses anon key; EV_Users is not readable via PostgREST joins (RLS). */
export async function getEvUserLookup(): Promise<EvUserLookup> {
  const { data, error } = await requireSupabase().rpc("list_ev_users");
  if (error) throw error;
  const map: EvUserLookup = new Map();
  for (const row of (data as Record<string, unknown>[]) ?? []) {
    map.set(row.id as string, {
      full_name: String(row.full_name ?? ""),
      email: String(row.email ?? ""),
    });
  }
  return map;
}
