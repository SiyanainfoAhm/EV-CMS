import { requireSupabase } from "@/utils/supabaseClient";

export async function listSimulatorUsers(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await requireSupabase().rpc("list_ev_users");
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
    id: r.id as string,
    name: r.full_name as string,
  }));
}
