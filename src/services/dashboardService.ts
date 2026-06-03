import * as sessionService from "@/services/sessionService";
import { requireSupabase } from "@/utils/supabaseClient";
import { formatRelativeTime } from "@/utils/supabaseMappers";
import type { TimeRange } from "@/types/ev";

export interface RecentActivityItem {
  id: string;
  event: string;
  time: string;
  type: string;
}

function getRangeStart(timeRange: TimeRange): Date {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const days = timeRange === "today" ? 1 : timeRange === "week" ? 7 : timeRange === "month" ? 30 : 90;
  // Inclusive range: last `days` including today.
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

function formatDayLabelFromISODate(isoDate: string): string {
  // isoDate is expected to be `YYYY-MM-DD` in UTC.
  const d = new Date(`${isoDate}T00:00:00Z`);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = days[d.getUTCDay()];
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${weekday} ${day}`;
}

export async function getRecentActivity(limit = 6, timeRange: TimeRange = "today"): Promise<RecentActivityItem[]> {
  const rangeStart = getRangeStart(timeRange).toISOString();

  const { data: events, error } = await requireSupabase()
    .from("EV_ChargerEvents")
    .select("id, event_type, payload, created_at, EV_Chargers ( name, charge_point_id )")
    .gte("created_at", rangeStart)
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
  const rangeMs = new Date(rangeStart).getTime();

  const sessions = [...active, ...history]
    .filter((s) => new Date(s.startTime).getTime() >= rangeMs || (s.endTime ? new Date(s.endTime).getTime() >= rangeMs : false))
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

export async function getEnergyChartData(timeRange: TimeRange = "today"): Promise<{ hour: string; kwh: number }[]> {
  const [active, history] = await Promise.all([
    sessionService.getActiveSessions(),
    sessionService.getSessionHistory(),
  ]);
  const sessions = [...active, ...history];
  const rangeStart = getRangeStart(timeRange).getTime();
  const inRange = sessions.filter((s) => new Date(s.startTime).getTime() >= rangeStart);
  const buckets = new Map<string, number>();

  if (timeRange === "today") {
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

    // Keep original “dense-ish” shape for the daily chart.
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hour, kwh]) => ({ hour, kwh: Math.round(kwh * 10) / 10 }));
  }

  // Week/month: bucket by day.
  const dayKeys: string[] = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  for (let d = new Date(rangeStart); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    dayKeys.push(d.toISOString().slice(0, 10));
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
