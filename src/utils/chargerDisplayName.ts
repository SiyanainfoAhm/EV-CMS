/**
 * Shared charger label rule for web admin (parity with mobile getChargerDisplayName).
 * display_name → name → charge_point_id → Unknown Charger
 */
export function getChargerDisplayName(charger: {
  displayName?: string | null;
  name?: string | null;
  chargePointId?: string | null;
} | null | undefined): string {
  const display = String(charger?.displayName ?? "").trim();
  if (display) return display;
  const name = String(charger?.name ?? "").trim();
  if (name) return name;
  const cpId = String(charger?.chargePointId ?? "").trim();
  if (cpId) return cpId;
  return "Unknown Charger";
}
