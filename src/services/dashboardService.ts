import * as sessionService from "@/services/sessionService";
import { requireSupabase } from "@/utils/supabaseClient";
import { formatRelativeTime } from "@/utils/supabaseMappers";
import {
  dashboardRangeLabel,
  resolveDashboardRange,
  utcRangeStart,
  type DashboardRange,
} from "@/utils/dateRanges";
import type { TimeRange } from "@/types/ev";

export interface RecentActivityItem {
  id: string;
  event: string;
  time: string;
  type: string;
}

function getRangeBounds(range: DashboardRange | TimeRange) {
  if (typeof range === "string") {
    const days = range === "today" ? 1 : range === "week" ? 7 : range === "month" ? 30 : 90;
    const end = new Date();
    end.setUTCHours(23, 59, 59, 999);
    return { start: utcRangeStart(days), end, preset: range === "today" ? "today" as const : range === "week" ? "week" as const : "month" as const };
  }
  return resolveDashboardRange(range);
}

function formatDayLabelFromISODate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = days[d.getUTCDay()];
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${weekday} ${day}`;
}

export async function getRecentActivity(
  limit = 6,
  range: DashboardRange | TimeRange = "today"
): Promise<RecentActivityItem[]> {
  const { start: rangeStart, end: rangeEnd } = getRangeBounds(range);
  const rangeStartIso = rangeStart.toISOString();
  const rangeEndIso = rangeEnd.toISOString();

  const { data: events, error } = await requireSupabase()
    .from("EV_ChargerEvents")
    .select("id, event_type, payload, created_at, EV_Chargers ( name, charge_point_id )")
    .gte("created_at", rangeStartIso)
    .lte("created_at", rangeEndIso)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!error && events?.length) {
    return events.map((row) => {
      const r = row as Record<string, unknown>;
      const charger = r.EV_Chargers as Record<string, unknown> | null;
      const cp = (charger?.charge_point_id as string) ?? (charger?.name as string) ?? "Charger";
      const type = String(r.event_type ?? "Event");
      return {
        id: r.id as string,
        event: `${type} — ${cp}`,
        time: formatRelativeTime(r.created_at as string),
        type: type.toLowerCase().includes("meter")
          ? "session"
          : type.toLowerCase().includes("stop")
            ? "payment"
            : "alert",
      };
    });
  }

  const [active, history] = await Promise.all([
    sessionService.getActiveSessions(),
    sessionService.getSessionHistory(),
  ]);
  const rangeMsStart = rangeStart.getTime();
  const rangeMsEnd = rangeEnd.getTime();

  const sessions = [...active, ...history]
    .filter((s) => {
      const t = new Date(s.startTime).getTime();
      return t >= rangeMsStart && t <= rangeMsEnd;
    })
    .sort((a, b) => {
      const at = new Date(a.endTime ?? a.startTime).getTime();
      const bt = new Date(b.endTime ?? b.startTime).getTime();
      return bt - at;
    })
    .slice(0, limit);

  return sessions.map((s) => {
    const base = `${s.chargerName || s.chargePointId || "Charger"} · Gun ${s.connectorId}`;
    const status = (s.status || "").toLowerCase();
    const isActive = status === "active";
    const isCompleted = status === "completed";
    const verb = isActive ? "Charging started" : isCompleted ? "Charging completed" : "Charging session";
    const energy = s.energyKwh != null ? `${s.energyKwh} kWh` : "";
    const suffix = energy ? ` (${energy})` : "";
    const timeIso = isCompleted ? (s.endTime ?? s.startTime) : s.startTime;
    return {
      id: s.id,
      event: `${verb} — ${base}${suffix}`,
      time: formatRelativeTime(timeIso),
      type: isActive ? "session" : isCompleted ? "payment" : "session",
    };
  });
}

export async function getEnergyChartData(
  range: DashboardRange | TimeRange = "today"
): Promise<{ hour: string; kwh: number }[]> {
  const [active, history] = await Promise.all([
    sessionService.getActiveSessions(),
    sessionService.getSessionHistory(),
  ]);
  const sessions = [...active, ...history];
  const { start: rangeStart, end: rangeEnd, preset } = getRangeBounds(range);
  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = rangeEnd.getTime();
  const inRange = sessions.filter((s) => {
    const t = new Date(s.startTime).getTime();
    return t >= rangeStartMs && t <= rangeEndMs;
  });
  const buckets = new Map<string, number>();

  if (preset === "today") {
    for (const s of inRange) {
      const d = new Date(s.startTime);
      const hour = `${String(d.getUTCHours()).padStart(2, "0")}:00`;
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

  const dayKeys: string[] = [];
  const cursor = new Date(rangeStart);
  cursor.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(rangeEnd);
  endDay.setUTCHours(0, 0, 0, 0);
  for (; cursor.getTime() <= endDay.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dayKeys.push(cursor.toISOString().slice(0, 10));
  }

  for (const s of inRange) {
    const d = new Date(s.startTime);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + (s.energyKwh || 0));
  }

  return dayKeys.map((key) => ({
    hour: formatDayLabelFromISODate(key),
    kwh: Math.round((buckets.get(key) ?? 0) * 10) / 10,
  }));
}

export { dashboardRangeLabel };
