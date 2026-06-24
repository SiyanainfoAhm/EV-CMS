import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { config } from "./config.js";
import { attachOcppWebSocket } from "./ocpp/server.js";
import { isSupabaseConfigured } from "./supabase/client.js";
import { ocppRouter } from "./routes/ocpp.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ev-cms-ocpp-gateway",
    version: "0.2.0",
    phase: "1-core",
    supabase: isSupabaseConfigured(),
    ocppPath: `${config.ocppWsPath}/{chargePointId}`,
  });
});

app.use("/ocpp", ocppRouter);

const httpServer = createServer(app);
attachOcppWebSocket(httpServer);

httpServer.listen(config.port, "0.0.0.0", () => {
  console.log(`[ev-cms-ocpp-gateway] REST  http://0.0.0.0:${config.port}`);
  console.log(`[ev-cms-ocpp-gateway] OCPP  ws://0.0.0.0:${config.port}${config.ocppWsPath}/<CHARGE_POINT_ID>`);
});
