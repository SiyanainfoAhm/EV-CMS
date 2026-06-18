import { requireSupabase } from "@/utils/supabaseClient";

/** Runs DB function to delete completed sessions older than 1 year. */
export async function archiveSessionsOlderThanOneYear(): Promise<number> {
  const { data, error } = await requireSupabase().rpc("archive_ev_sessions_older_than_one_year");
  if (error) throw error;
  return typeof data === "number" ? data : Number(data ?? 0);
}
