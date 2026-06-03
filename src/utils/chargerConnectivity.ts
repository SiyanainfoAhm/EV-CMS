/** Heartbeat-based connectivity (OCPP simulator + real gateways). */

export const HEARTBEAT_ONLINE_MS = 5 * 60 * 1000;
export const HEARTBEAT_OFFLINE_MS = 15 * 60 * 1000;

export function heartbeatAgeMs(lastHeartbeat?: string | null): number {
  if (!lastHeartbeat) return Number.POSITIVE_INFINITY;
  return Date.now() - new Date(lastHeartbeat).getTime();
}

export function isOnlineByHeartbeat(lastHeartbeat?: string | null): boolean {
  return heartbeatAgeMs(lastHeartbeat) < HEARTBEAT_ONLINE_MS;
}

export function isOfflineByHeartbeat(lastHeartbeat?: string | null): boolean {
  return heartbeatAgeMs(lastHeartbeat) > HEARTBEAT_OFFLINE_MS;
}

export type ConnectivityLabel = "online" | "offline" | "stale";

export function connectivityFromHeartbeat(lastHeartbeat?: string | null): ConnectivityLabel {
  const age = heartbeatAgeMs(lastHeartbeat);
  if (age < HEARTBEAT_ONLINE_MS) return "online";
  if (age > HEARTBEAT_OFFLINE_MS) return "offline";
  return "stale";
}

export function formatHeartbeatAgo(lastHeartbeat?: string | null): string {
  if (!lastHeartbeat) return "Never";
  const secs = Math.floor(heartbeatAgeMs(lastHeartbeat) / 1000);
  if (secs < 60) return `${secs} sec ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr ago`;
}
