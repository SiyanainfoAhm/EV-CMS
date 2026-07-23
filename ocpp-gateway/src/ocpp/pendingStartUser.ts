/** Pending mobile/web user to attribute when StartTransaction arrives after RemoteStart. */

type PendingStart = {
  userId: string;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const pendingByKey = new Map<string, PendingStart>();

function key(chargePointId: string, connectorId: number): string {
  return `${chargePointId.toUpperCase()}:${connectorId}`;
}

export function setPendingStartUser(
  chargePointId: string,
  connectorId: number,
  userId: string,
  ttlMs = DEFAULT_TTL_MS
): void {
  if (!userId?.trim()) return;
  pendingByKey.set(key(chargePointId, connectorId), {
    userId: userId.trim(),
    expiresAt: Date.now() + ttlMs,
  });
}

export function takePendingStartUser(chargePointId: string, connectorId: number): string | null {
  const k = key(chargePointId, connectorId);
  const pending = pendingByKey.get(k);
  if (!pending) return null;
  pendingByKey.delete(k);
  if (Date.now() > pending.expiresAt) return null;
  return pending.userId;
}
