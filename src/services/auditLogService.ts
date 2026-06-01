import type { AuditLog } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapAuditLog } from "@/utils/supabaseMappers";

export async function getAuditLogs(): Promise<AuditLog[]> {
  const { data, error } = await requireSupabase()
    .from("EV_AuditLogs")
    .select("*, EV_Users ( full_name )")
    .order("created_at", { ascending: false });

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
