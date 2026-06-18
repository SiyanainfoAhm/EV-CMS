import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "../config.js";
import { isSupabaseConfigured } from "../supabase/client.js";
import * as repo from "../supabase/repository.js";
import { registerConnection, unregisterConnection } from "./connections.js";
import { handleInboundMessage } from "./handlers.js";
function extractChargePointId(url: string | undefined): string | null {
  if (!url) return null;
  const path = url.split("?")[0];
  const prefix = `${config.ocppWsPath}/`;
  if (!path.startsWith(prefix)) return null;
  const id = decodeURIComponent(path.slice(prefix.length)).trim().toUpperCase();
  return id.length > 0 ? id : null;
}

export function attachOcppWebSocket(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const chargePointId = extractChargePointId(request.url);
    if (!chargePointId) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, chargePointId);
    });
  });

  wss.on("connection", (ws: WebSocket, chargePointId: string) => {
    const conn = registerConnection(chargePointId, ws);
    console.log(`[ocpp] Connected: ${chargePointId}`);

    ws.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      void handleInboundMessage(conn, raw);
    });

    ws.on("close", () => {
      unregisterConnection(chargePointId, ws);
      console.log(`[ocpp] Disconnected: ${chargePointId}`);
      if (isSupabaseConfigured()) {
        void repo.markChargerOffline(chargePointId).catch((err) => {
          console.error(`[ocpp] Failed to mark ${chargePointId} offline:`, err);
        });
      }
    });

    ws.on("error", (err) => {
      console.error(`[ocpp] Socket error ${chargePointId}:`, err.message);
    });
  });

  return wss;
}
