import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { attachOcppWebSocket } from "./ocpp/server.js";
import { ocppRouter } from "./routes/ocpp.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ev-cms-ocpp-gateway",
    version: "0.1.0",
    phase: "0-scaffold",
  });
});

app.use("/ocpp", ocppRouter);

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: config.ocppWsPath });
attachOcppWebSocket(wss);

httpServer.listen(config.port, () => {
  console.log(`[ev-cms-ocpp-gateway] REST http://localhost:${config.port}`);
  console.log(`[ev-cms-ocpp-gateway] OCPP WS  ws://localhost:${config.port}${config.ocppWsPath}`);
});
