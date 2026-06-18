/** Haversine distance in kilometres between two WGS84 points. */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistanceKm(km: number): string {
  if (km < 1) return (km * 1000).toFixed(0);
  return km.toFixed(1);
}

export function formatDistanceLabel(km: number, unit: "km" | "m" = "km"): string {
  if (unit === "m" || km < 1) return `${formatDistanceKm(km)} m`;
  return `${formatDistanceKm(km)} km`;
}
