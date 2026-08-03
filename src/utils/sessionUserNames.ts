import type { ChargingSession } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { resolveSessionUserDisplayName } from "@/utils/supabaseMappers";

/**
 * EV_Users is blocked for anon SELECT (password_hash). Session embeds of EV_Users
 * therefore return null → "Unknown User". Resolve names via list_ev_users (SECURITY DEFINER).
 */
export async function loadUserDisplayNameMap(): Promise<Map<string, string>> {
  const { data, error } = await requireSupabase().rpc("list_ev_users");
  if (error) throw error;

  const map = new Map<string, string>();
  for (const row of (data as Record<string, unknown>[]) ?? []) {
    const id = String(row.id ?? "").trim();
    if (!id) continue;
    const name = resolveSessionUserDisplayName(row);
    if (name !== "Unknown User") map.set(id, name);
  }
  return map;
}

export function applyUserNamesToSessions(
  sessions: ChargingSession[],
  names: Map<string, string>
): ChargingSession[] {
  return sessions.map((session) => {
    if (session.userName && session.userName !== "Unknown User") return session;
    const name = names.get(session.userId);
    return name ? { ...session, userName: name } : session;
  });
}
