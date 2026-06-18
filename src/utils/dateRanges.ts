/** UTC date helpers — avoid hardcoded demo dates in admin UI. */

export function utcTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
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
