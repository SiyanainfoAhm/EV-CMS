/** idTag sent to charger when admin uses web Remote Start with RFID bypass. */
export const ADMIN_BYPASS_ID_TAG = "ADMIN-BYPASS";

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

const bypassUntilByCp = new Map<string, number>();

export function enableAdminRfidBypass(chargePointId: string, durationMs = DEFAULT_WINDOW_MS): void {
  bypassUntilByCp.set(chargePointId.toUpperCase(), Date.now() + durationMs);
}

export function isAdminRfidBypassActive(chargePointId: string): boolean {
  const cpId = chargePointId.toUpperCase();
  const until = bypassUntilByCp.get(cpId);
  if (!until) return false;
  if (Date.now() > until) {
    bypassUntilByCp.delete(cpId);
    return false;
  }
  return true;
}
