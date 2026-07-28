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

async function insertAuditLog(row: {
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
}): Promise<void> {
  const { error } = await requireSupabase().from("EV_AuditLogs").insert(row);
  if (error) {
    console.warn(`[audit] ${row.action} log failed:`, error.message);
  }
}

export async function logAdminRemoteStart(input: {
  userId: string;
  chargePointId: string;
  connectorId: number;
  chargerId: string;
}): Promise<void> {
  await insertAuditLog({
    user_id: input.userId,
    action: "Admin Remote Start",
    entity_type: "Charger",
    entity_id: input.chargerId,
    details: `Admin RemoteStart on ${input.chargePointId} Gun ${input.connectorId} (attributed to admin user)`,
  });
}

/** @deprecated Use logAdminRemoteStart */
export async function logLabBypassRemoteStart(input: {
  userId: string;
  chargePointId: string;
  connectorId: number;
  chargerId: string;
}): Promise<void> {
  return logAdminRemoteStart(input);
}

/** Admin tried RemoteStart on a production charger (lab bypass off). */
export async function logBlockedRemoteStart(input: {
  userId: string;
  chargePointId: string;
  connectorId: number;
  chargerId: string;
}): Promise<void> {
  await insertAuditLog({
    user_id: input.userId,
    action: "Blocked Remote Start",
    entity_type: "Charger",
    entity_id: input.chargerId,
    details: `RemoteStart blocked — prepaid required (lab bypass off) on ${input.chargePointId} Gun ${input.connectorId}`,
  });
}

/** Admin RemoteStart attempted but OCPP/gateway rejected or failed. */
export async function logFailedAdminRemoteStart(input: {
  userId: string;
  chargePointId: string;
  connectorId: number;
  chargerId: string;
  reason: string;
}): Promise<void> {
  const reason = input.reason.trim().slice(0, 240) || "unknown error";
  await insertAuditLog({
    user_id: input.userId,
    action: "Failed Admin Remote Start",
    entity_type: "Charger",
    entity_id: input.chargerId,
    details: `Admin RemoteStart failed on ${input.chargePointId} Gun ${input.connectorId}: ${reason}`,
  });
}

/** @deprecated Use logFailedAdminRemoteStart */
export async function logFailedLabBypassRemoteStart(input: {
  userId: string;
  chargePointId: string;
  connectorId: number;
  chargerId: string;
  reason: string;
}): Promise<void> {
  return logFailedAdminRemoteStart(input);
}

/** Charger allow_admin_bypass enabled or disabled. */
export async function logLabBypassFlagChange(input: {
  userId: string;
  chargerId: string;
  chargePointId: string;
  enabled: boolean;
  isCreate?: boolean;
}): Promise<void> {
  const verb = input.enabled ? "Enabled" : "Disabled";
  await insertAuditLog({
    user_id: input.userId,
    action: `${verb} Lab Admin Bypass`,
    entity_type: "Charger",
    entity_id: input.chargerId,
    details: input.isCreate
      ? `Created charger ${input.chargePointId} with lab admin bypass ${input.enabled ? "on" : "off"}`
      : `Lab admin bypass ${input.enabled ? "enabled" : "disabled"} on ${input.chargePointId}`,
  });
}

export async function logPrepaidPlanCreated(input: {
  userId: string;
  planId: string;
  label: string;
  mode: string;
  value: number;
}): Promise<void> {
  await insertAuditLog({
    user_id: input.userId,
    action: "Created Prepaid Plan",
    entity_type: "PrepaidPlan",
    entity_id: input.planId,
    details: `Created prepaid plan "${input.label}" (${input.mode}=${input.value})`,
  });
}

export async function logPrepaidPlanUpdated(input: {
  userId: string;
  planId: string;
  label: string;
  mode: string;
  value: number;
}): Promise<void> {
  await insertAuditLog({
    user_id: input.userId,
    action: "Updated Prepaid Plan",
    entity_type: "PrepaidPlan",
    entity_id: input.planId,
    details: `Updated prepaid plan "${input.label}" (${input.mode}=${input.value})`,
  });
}

export async function logPrepaidPlanToggled(input: {
  userId: string;
  planId: string;
  label: string;
  isActive: boolean;
}): Promise<void> {
  await insertAuditLog({
    user_id: input.userId,
    action: input.isActive ? "Activated Prepaid Plan" : "Deactivated Prepaid Plan",
    entity_type: "PrepaidPlan",
    entity_id: input.planId,
    details: `${input.isActive ? "Activated" : "Deactivated"} prepaid plan "${input.label}"`,
  });
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
