import type { WebSocketServer } from "ws";

/** OCPP 1.6J WebSocket handler — Phase 1 implementation. */
export function attachOcppWebSocket(_wss: WebSocketServer): void {
  // TODO Phase 1: BootNotification, Heartbeat, StatusNotification,
  // Authorize, Start/StopTransaction, MeterValues, RemoteStart/Stop
}
