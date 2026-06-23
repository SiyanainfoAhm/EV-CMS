/** UTC date helpers — avoid hardcoded demo dates in admin UI. */

import type { TimeRange } from "@/types/ev";

export type DashboardPreset = "today" | "week" | "month" | "custom";

export type DashboardRange =
  | { preset: Exclude<DashboardPreset, "custom"> }
  | { preset: "custom"; start: string; end: string };

export function utcTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function utcDaysAgoKey(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

export function isUtcToday(iso: string): boolean {
  return iso.slice(0, 10) === utcTodayKey();
}

export function utcRangeStart(days: number): Date {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

export function resolveDashboardRange(range: DashboardRange): { start: Date; end: Date; preset: DashboardPreset } {
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);

  if (range.preset === "custom") {
    const start = new Date(`${range.start}T00:00:00.000Z`);
    const customEnd = new Date(`${range.end}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(customEnd.getTime())) {
      return { start: utcRangeStart(7), end, preset: "week" };
    }
    if (start.getTime() > customEnd.getTime()) {
      return { start: customEnd, end: start, preset: "custom" };
    }
    return { start, end: customEnd, preset: "custom" };
  }

  const days = range.preset === "today" ? 1 : range.preset === "week" ? 7 : 30;
  return { start: utcRangeStart(days), end, preset: range.preset };
}

export function isoDayStart(dateKey: string): string {
  return `${dateKey}T00:00:00.000Z`;
}

export function isoDayEnd(dateKey: string): string {
  return `${dateKey}T23:59:59.999Z`;
}

export function dashboardRangeLabel(range: DashboardRange): string {
  if (range.preset === "today") return "Today";
  if (range.preset === "week") return "Week";
  if (range.preset === "month") return "Month";
  if (range.preset === "custom") {
    const { start, end } = resolveDashboardRange(range);
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
    return `${fmt(start)} – ${fmt(end)}`;
  }
  return "Custom";
}

export type ReportsPreset = "today" | "week" | "month" | "quarter" | "custom";

export type ReportsRange =
  | { preset: Exclude<ReportsPreset, "custom"> }
  | { preset: "custom"; start: string; end: string };

export function resolveReportsRange(range: ReportsRange): { start: Date; end: Date } {
  if (range.preset === "custom") {
    const { start, end } = resolveDashboardRange({ preset: "custom", start: range.start, end: range.end });
    return { start, end };
  }

  const days =
    range.preset === "today" ? 1 : range.preset === "week" ? 7 : range.preset === "month" ? 30 : 90;
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  return { start: utcRangeStart(days), end };
}

export function reportsRangeLabel(range: ReportsRange): string {
  if (range.preset === "today") return "today";
  if (range.preset === "week") return "this week";
  if (range.preset === "month") return "this month";
  if (range.preset === "quarter") return "this quarter";
  const { start, end } = resolveReportsRange(range);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Stable key for dashboard/reports range — avoids refetch loops from new object identity each render. */
export function dashboardRangeKey(range: DashboardRange | TimeRange): string {
  if (typeof range === "string") return range;
  if (range.preset === "custom") return `custom:${range.start}:${range.end}`;
  return range.preset;
}
