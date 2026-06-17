import type WebSocket from "ws";

export interface ChargePointConnection {
  ws: WebSocket;
  chargePointId: string;
  chargerDbId: string | null;
  connectedAt: Date;
  lastHeartbeatAt: Date | null;
  heartbeatIntervalSec: number;
}

const connections = new Map<string, ChargePointConnection>();

export function registerConnection(chargePointId: string, ws: WebSocket): ChargePointConnection {
  const existing = connections.get(chargePointId);
  if (existing && existing.ws !== ws) {
    try {
      existing.ws.close(1000, "Replaced by new connection");
    } catch {
      /* ignore */
    }
  }
  const conn: ChargePointConnection = {
    ws,
    chargePointId,
    chargerDbId: existing?.chargerDbId ?? null,
    connectedAt: new Date(),
    lastHeartbeatAt: existing?.lastHeartbeatAt ?? null,
    heartbeatIntervalSec: 300,
  };
  connections.set(chargePointId, conn);
  return conn;
}

export function unregisterConnection(chargePointId: string, ws: WebSocket): void {
  const conn = connections.get(chargePointId);
  if (conn?.ws === ws) {
    connections.delete(chargePointId);
  }
}

export function getConnection(chargePointId: string): ChargePointConnection | undefined {
  return connections.get(chargePointId);
}

export function setChargerDbId(chargePointId: string, chargerDbId: string): void {
  const conn = connections.get(chargePointId);
  if (conn) conn.chargerDbId = chargerDbId;
}

export function listConnections(): ChargePointConnection[] {
  return [...connections.values()];
}

export function isConnected(chargePointId: string): boolean {
  const conn = connections.get(chargePointId);
  return Boolean(conn && conn.ws.readyState === conn.ws.OPEN);
}
