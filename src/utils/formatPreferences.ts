import type { SystemPreferences } from "@/types/profile";
import { DEFAULT_SYSTEM_SETTINGS } from "@/types/profile";

const CURRENCY_LOCALE: Record<string, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
};

function dateFormatOptions(format: string): Intl.DateTimeFormatOptions {
  switch (format) {
    case "MM/DD/YYYY":
      return { year: "numeric", month: "2-digit", day: "2-digit" };
    case "YYYY-MM-DD":
      return { year: "numeric", month: "2-digit", day: "2-digit" };
    default:
      return { year: "numeric", month: "2-digit", day: "2-digit" };
  }
}

function formatDateParts(date: Date, format: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  switch (format) {
    case "MM/DD/YYYY":
      return `${m}/${d}/${y}`;
    case "YYYY-MM-DD":
      return `${y}-${m}-${d}`;
    default:
      return `${d}/${m}/${y}`;
  }
}

export function formatDate(iso: string | Date | null | undefined, settings?: SystemPreferences): string {
  if (!iso) return "—";
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const prefs = settings ?? DEFAULT_SYSTEM_SETTINGS;
  return formatDateParts(date, prefs.dateFormat);
}

export function formatDateTime(iso: string | Date | null | undefined, settings?: SystemPreferences): string {
  if (!iso) return "—";
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const prefs = settings ?? DEFAULT_SYSTEM_SETTINGS;
  const locale = CURRENCY_LOCALE[prefs.currency] ?? "en-IN";
  const time = date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: prefs.timeFormat === "12h",
  });
  return `${formatDateParts(date, prefs.dateFormat)} ${time}`;
}

export function formatCurrency(amount: number, settings?: SystemPreferences): string {
  const prefs = settings ?? DEFAULT_SYSTEM_SETTINGS;
  const locale = CURRENCY_LOCALE[prefs.currency] ?? "en-IN";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: prefs.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatEnergy(kwh: number, settings?: SystemPreferences): string {
  const prefs = settings ?? DEFAULT_SYSTEM_SETTINGS;
  if (prefs.energyUnit === "MWh") {
    return `${(kwh / 1000).toFixed(3)} MWh`;
  }
  return `${kwh.toFixed(2)} kWh`;
}

/** Used when a plain locale format is enough (e.g. chart axis). */
export function energyUnitLabel(settings?: SystemPreferences): string {
  return (settings ?? DEFAULT_SYSTEM_SETTINGS).energyUnit;
}

export function localeForCurrency(settings?: SystemPreferences): string {
  const prefs = settings ?? DEFAULT_SYSTEM_SETTINGS;
  return CURRENCY_LOCALE[prefs.currency] ?? "en-IN";
}

export function dateFormatOptionsForLocale(settings?: SystemPreferences): Intl.DateTimeFormatOptions {
  const prefs = settings ?? DEFAULT_SYSTEM_SETTINGS;
  return dateFormatOptions(prefs.dateFormat);
}
