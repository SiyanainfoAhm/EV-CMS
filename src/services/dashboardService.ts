import * as auditLogService from "@/services/auditLogService";
import * as sessionService from "@/services/sessionService";
import { auditTypeFromEntity, formatRelativeTime } from "@/utils/supabaseMappers";

export interface RecentActivityItem {
  id: string;
  event: string;
  time: string;
  type: string;
}

export async function getRecentActivity(limit = 6): Promise<RecentActivityItem[]> {
  const logs = await auditLogService.getAuditLogs();
  return logs.slice(0, limit).map((log) => ({
    id: log.id,
    event: log.details || `${log.action} — ${log.entityType}`,
    time: formatRelativeTime(log.createdAt),
    type: auditTypeFromEntity(log.entityType),
  }));
}

export async function getEnergyChartData(): Promise<{ hour: string; kwh: number }[]> {
  const [active, history] = await Promise.all([
    sessionService.getActiveSessions(),
    sessionService.getSessionHistory(),
  ]);
  const sessions = [...active, ...history];
  const buckets = new Map<string, number>();

  for (const s of sessions) {
    const d = new Date(s.startTime);
    const hour = `${String(d.getHours()).padStart(2, "0")}:00`;
    buckets.set(hour, (buckets.get(hour) ?? 0) + (s.energyKwh || 0));
  }

  if (buckets.size === 0) {
    return [
      { hour: "06:00", kwh: 0 },
      { hour: "12:00", kwh: 0 },
      { hour: "18:00", kwh: 0 },
    ];
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, kwh]) => ({ hour, kwh: Math.round(kwh * 10) / 10 }));
}
