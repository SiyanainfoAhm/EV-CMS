import { Router } from "express";

/** REST API matching web `src/services/ocppService.ts` — Phase 1 implements real OCPP calls. */
export const ocppRouter = Router();

ocppRouter.post("/remote-start", (req, res) => {
  res.json({ accepted: true, stub: true, body: req.body });
});

ocppRouter.post("/remote-stop", (req, res) => {
  res.json({ accepted: true, stub: true, body: req.body });
});

ocppRouter.post("/reset", (req, res) => {
  res.json({ accepted: true, stub: true, body: req.body });
});

ocppRouter.get("/chargers/:chargePointId/status", (req, res) => {
  res.json({ status: "Unknown", stub: true, chargePointId: req.params.chargePointId });
});

ocppRouter.get("/chargers/:chargePointId/connectors/:connectorId", (req, res) => {
  res.json({
    stub: true,
    chargePointId: req.params.chargePointId,
    connectorId: Number(req.params.connectorId),
  });
});

ocppRouter.post("/change-configuration", (req, res) => {
  res.json({ accepted: true, stub: true, body: req.body });
});

ocppRouter.post("/trigger-meter-values", (req, res) => {
  res.json({ accepted: true, stub: true, body: req.body });
});
