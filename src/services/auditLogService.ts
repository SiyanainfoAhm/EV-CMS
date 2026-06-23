import type { AuditLog } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapAuditLog } from "@/utils/supabaseMappers";
import { isoDayEnd, isoDayStart } from "@/utils/dateRanges";

export interface AuditLogsQuery {
  action?: string; // exact action or all
  userName?: string; // exact user display name or all
  search?: string; // action/details/entityType/user
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export async function getAuditLogs(query: AuditLogsQuery = {}): Promise<AuditLog[]> {
  const { action = "all", userName = "all", search = "", dateFrom, dateTo, limit = 500 } = query;

  let q = requireSupabase()
    .from("EV_AuditLogs")
    .select("*, EV_Users!left ( full_name )")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (action !== "all") q = q.eq("action", action);
  if (dateFrom) q = q.gte("created_at", isoDayStart(dateFrom));
  if (dateTo) q = q.lte("created_at", isoDayEnd(dateTo));

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

export async function logReportExport(input: {
  userId: string;
  reportName: string;
  format: string;
  rangeLabel: string;
}): Promise<void> {
  const { error } = await requireSupabase().from("EV_AuditLogs").insert({
    user_id: input.userId,
    action: "Export Report",
    entity_type: "Report",
    entity_id: input.reportName,
    details: `Exported ${input.reportName} as ${input.format} for ${input.rangeLabel}`,
  });

  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Cannot log export: ensure EV_AuditLogs insert policy is enabled."
        : error.message
    );
  }
}
