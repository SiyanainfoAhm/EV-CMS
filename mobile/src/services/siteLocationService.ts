import { requireSupabase } from "../utils/supabaseClient";

export type DefaultSiteLocation = {
  latitude: number;
  longitude: number;
  label?: string;
};

let cachedSite: { at: number; value: DefaultSiteLocation | null } | null = null;
const CACHE_MS = 60_000;

/**
 * Optional EV_SystemConfig key `default_site_location`:
 * { "latitude": 28.xx, "longitude": 77.xx, "label": "Sector 145, Noida" }
 */
export async function getDefaultSiteLocation(): Promise<DefaultSiteLocation | null> {
  if (cachedSite && Date.now() - cachedSite.at < CACHE_MS) {
    return cachedSite.value;
  }
  try {
    const { data, error } = await requireSupabase()
      .from("EV_SystemConfig")
      .select("value")
      .eq("key", "default_site_location")
      .maybeSingle();
    if (error || !data) {
      cachedSite = { at: Date.now(), value: null };
      return null;
    }
    const raw = (data as { value: unknown }).value;
    const parsed =
      typeof raw === "string"
        ? (JSON.parse(raw) as Record<string, unknown>)
        : (raw as Record<string, unknown>);
    const latitude = Number(parsed?.latitude);
    const longitude = Number(parsed?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      cachedSite = { at: Date.now(), value: null };
      return null;
    }
    const value: DefaultSiteLocation = {
      latitude,
      longitude,
      label: parsed?.label != null ? String(parsed.label) : undefined,
    };
    cachedSite = { at: Date.now(), value };
    return value;
  } catch {
    cachedSite = { at: Date.now(), value: null };
    return null;
  }
}

/** Slight per-charger offset so multiple markers at the same site are visible. */
export function offsetSiteCoordinate(
  base: { latitude: number; longitude: number },
  index: number
): { latitude: number; longitude: number } {
  const ring = Math.floor(index / 8);
  const slot = index % 8;
  const angle = (slot / 8) * Math.PI * 2;
  const meters = 25 + ring * 20;
  const dLat = (meters * Math.cos(angle)) / 111_320;
  const dLng = (meters * Math.sin(angle)) / (111_320 * Math.cos((base.latitude * Math.PI) / 180));
  return {
    latitude: base.latitude + dLat,
    longitude: base.longitude + dLng,
  };
}
