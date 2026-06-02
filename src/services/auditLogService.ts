import type { AuditLog } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapAuditLog } from "@/utils/supabaseMappers";

export interface AuditLogsQuery {
  action?: string; // exact action or all
  userName?: string; // exact user display name or all
  search?: string; // action/details/entityType/user
  limit?: number;
}

export async function getAuditLogs(query: AuditLogsQuery = {}): Promise<AuditLog[]> {
  const { action = "all", userName = "all", search = "", limit = 500 } = query;

  let q = requireSupabase()
    .from("EV_AuditLogs")
    .select("*, EV_Users!left ( full_name )")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (action !== "all") q = q.eq("action", action);

  // `userName` is derived from the join; without a dedicated RPC we can't reliably filter on it server-side.
  // We'll still filter it client-side in the page after fetching.

  const s = search.trim();
  if (s) {
    q = q.or(`action.ilike.%${s}%,details.ilike.%${s}%,entity_type.ilike.%${s}%,ip_address.ilike.%${s}%`);
  }

  const { data, error } = await q;

  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return mapAuditLog(r, r.EV_Users as Record<string, unknown> | null);
  });
}

export async function getAuditLogsByEntity(
  entityType: string,
  entityId: string
): Promise<AuditLog[]> {
  const logs = await getAuditLogs();
  return logs.filter((l) => l.entityType === entityType && l.entityId === entityId);
}
