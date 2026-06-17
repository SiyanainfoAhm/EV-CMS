import type { TFunction } from "i18next";

export type EnumNamespace = "status" | "priority";

/** Lowercase, trim, collapse spaces/hyphens/slashes to underscores. */
export function normalizeEnumKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, "_")
    .replace(/_+/g, "_");
}

/** Map a DB enum/code to a translated label; falls back to the raw value. */
export function translateEnum(
  t: TFunction,
  namespace: EnumNamespace,
  value: string | null | undefined
): string {
  if (value == null || value === "") return "";
  const key = normalizeEnumKey(value);
  return t(`${namespace}.${key}`, { defaultValue: value });
}

/** MP-DC-001 → MP_DC_001 for i18n key paths. */
export function safeChargerCode(code: string): string {
  return code
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function translateChargerName(
  t: TFunction,
  chargePointId: string,
  fallback: string
): string {
  const safe = safeChargerCode(chargePointId);
  if (!safe) return fallback;
  return t(`chargers.${safe}.name`, { defaultValue: fallback });
}

export function translateChargerLocation(
  t: TFunction,
  chargePointId: string,
  fallback: string
): string {
  const safe = safeChargerCode(chargePointId);
  if (!safe) return fallback;
  return t(`chargers.${safe}.location`, { defaultValue: fallback });
}

export function translateChargerType(t: TFunction, type: string): string {
  const key = normalizeEnumKey(type);
  return t(`charger.types.${key}`, { defaultValue: type });
}
