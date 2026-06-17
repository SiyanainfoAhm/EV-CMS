/** OCPP 1.6 JSON over WebSocket message helpers */

export const MSG_CALL = 2;
export const MSG_CALL_RESULT = 3;
export const MSG_CALL_ERROR = 4;

export type OcppInbound =
  | { kind: "call"; uniqueId: string; action: string; payload: Record<string, unknown> }
  | { kind: "callResult"; uniqueId: string; payload: unknown }
  | { kind: "callError"; uniqueId: string; code: string; description: string; details?: unknown };

export function parseMessage(raw: string): OcppInbound {
  const msg = JSON.parse(raw) as unknown;
  if (!Array.isArray(msg) || msg.length < 3) {
    throw new Error("Invalid OCPP message");
  }
  const typeId = msg[0] as number;
  const uniqueId = String(msg[1]);

  if (typeId === MSG_CALL) {
    return {
      kind: "call",
      uniqueId,
      action: String(msg[2]),
      payload: (msg[3] as Record<string, unknown>) ?? {},
    };
  }
  if (typeId === MSG_CALL_RESULT) {
    return { kind: "callResult", uniqueId, payload: msg[2] };
  }
  if (typeId === MSG_CALL_ERROR) {
    return {
      kind: "callError",
      uniqueId,
      code: String(msg[2]),
      description: String(msg[3] ?? ""),
      details: msg[4],
    };
  }
  throw new Error(`Unknown OCPP message type: ${typeId}`);
}

export function buildCall(uniqueId: string, action: string, payload: Record<string, unknown>): string {
  return JSON.stringify([MSG_CALL, uniqueId, action, payload]);
}

export function buildCallResult(uniqueId: string, payload: Record<string, unknown>): string {
  return JSON.stringify([MSG_CALL_RESULT, uniqueId, payload]);
}

export function buildCallError(uniqueId: string, code: string, description: string): string {
  return JSON.stringify([MSG_CALL_ERROR, uniqueId, code, description, {}]);
}

export function newUniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
