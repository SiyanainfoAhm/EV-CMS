import { useState, useMemo, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as chargerService from "@/services/chargerService";
import * as ocppService from "@/services/ocppService";
import { OcppGatewayError } from "@/services/ocppService";
import { notifyFirmwareAlert } from "@/services/operationalAlertService";
import * as tariffService from "@/services/tariffService";
import { useSupabaseRealtime } from "@/hooks/useSupabaseRealtime";
import { ChargerFormModal, chargerToForm } from "@/components/chargers/ChargerFormModal";
import { buildOcppWebSocketUrl } from "@/utils/ocppUrls";
import { useOcppGatewayConfig } from "@/hooks/useOcppGatewayConfig";
import {
  connectivityFromHeartbeat,
  formatHeartbeatAgo,
  type ConnectivityLabel,
} from "@/utils/chargerConnectivity";
import type { Charger, ChargingSession, Tariff } from "@/types/ev";

function getRelativeTime(isoStr: string): string {
  const now = new Date();
  const then = new Date(isoStr);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

function getConnectivityColor(connectivity: ConnectivityLabel | "faulted"): string {
  switch (connectivity) {
    case "online":
      return "bg-emerald-500";
    case "stale":
      return "bg-amber-400";
    case "offline":
      return "bg-gray-400";
    case "faulted":
      return "bg-red-500";
    default:
      return "bg-gray-400";
  }
}

function getConnectivityTextClass(connectivity: ConnectivityLabel | "faulted"): string {
  switch (connectivity) {
    case "online":
      return "text-emerald-600";
    case "stale":
      return "text-amber-600";
    case "faulted":
      return "text-red-500";
    default:
      return "text-gray-500";
  }
}

export default function ChargerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [charger, setCharger] = useState<Charger | undefined>();
  const [mockActiveSessions, setMockActiveSessions] = useState<ChargingSession[]>([]);
  const [ocppEvents, setOcppEvents] = useState<chargerService.ChargerEvent[]>([]);
  const [ocppTab, setOcppTab] = useState<"recent" | "all">("recent");

  const reloadChargerData = useCallback(() => {
    if (!id) return;
    chargerService.getChargerById(id).then(setCharger);
    chargerService.getActiveSessionsForChargers().then(setMockActiveSessions);
    chargerService.getChargerEvents(id).then(setOcppEvents);
  }, [id]);

  useEffect(() => {
    reloadChargerData();
  }, [reloadChargerData]);

  useSupabaseRealtime(reloadChargerData);

  useEffect(() => {
    if (!charger) {
      setEffectiveTariff(null);
      return;
    }
    void tariffService.resolveTariffForCharger(charger).then(setEffectiveTariff);
  }, [charger?.id, charger?.tariffId, charger?.type]);

  useEffect(() => {
    if (!charger?.chargePointId) return;
    const check = () => {
      ocppService.getChargerStatus(charger.chargePointId).then((s) => {
        setOcppSocketLive(Boolean(s.connected));
      }).catch(() => setOcppSocketLive(false));
    };
    check();
    const timer = setInterval(check, 15000);
    return () => clearInterval(timer);
  }, [charger?.chargePointId]);

  const ocppMessages = useMemo(() => {
    const list = ocppTab === "recent" ? ocppEvents.slice(0, 10) : ocppEvents;
    return list.map((ev) => ({
      id: ev.id,
      direction: ev.eventType.includes(".conf") || ev.eventType.endsWith("Response") ? "out" : "in",
      message: ev.eventType,
      time: ev.createdAt,
      details: ev.payload,
    }));
  }, [ocppEvents, ocppTab]);

  const sessions = useMemo(
    () => mockActiveSessions.filter((s) => s.chargePointId === charger?.chargePointId),
    [charger, mockActiveSessions],
  );

  const [selectedConnector, setSelectedConnector] = useState<number | null>(null);
  const [actionModal, setActionModal] = useState<{ type: string; connectorId: number } | null>(null);
  const [actionResult, setActionResult] = useState<{ success: boolean; message: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [ocppSocketLive, setOcppSocketLive] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showFirmwareModal, setShowFirmwareModal] = useState(false);
  const [firmwareUrl, setFirmwareUrl] = useState("");
  const [firmwareLoading, setFirmwareLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [effectiveTariff, setEffectiveTariff] = useState<Tariff | null>(null);
  const [showDecommissionConfirm, setShowDecommissionConfirm] = useState(false);
  const [decommissionLoading, setDecommissionLoading] = useState(false);
  useOcppGatewayConfig();

  if (!charger) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-16 h-16 flex items-center justify-center rounded-full bg-gray-100 mb-4">
          <i className="ri-error-warning-line text-gray-300 text-2xl"></i>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Charger Not Found</h2>
        <p className="text-sm text-gray-500 mb-4">The charger you are looking for does not exist.</p>
        <button
          onClick={() => navigate("/chargers")}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap"
        >
          Back to Chargers
        </button>
      </div>
    );
  }

  const connectivityLabel: ConnectivityLabel | "faulted" =
    charger.status === "decommissioned"
      ? "offline"
      : charger.status === "faulted"
        ? "faulted"
        : connectivityFromHeartbeat(charger.lastHeartbeat);

  const handleDecommission = async () => {
    if (!charger) return;
    setDecommissionLoading(true);
    try {
      await chargerService.decommissionCharger(charger.id);
      setShowDecommissionConfirm(false);
      setToast("Charger decommissioned");
      setTimeout(() => navigate("/chargers"), 1200);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Decommission failed");
      setTimeout(() => setToast(null), 4000);
    } finally {
      setDecommissionLoading(false);
    }
  };

  const handleFirmwareUpdate = async () => {
    if (!charger || !firmwareUrl.trim()) return;
    setFirmwareLoading(true);
    try {
      const result = await ocppService.updateFirmware(charger.chargePointId, firmwareUrl.trim());
      setShowFirmwareModal(false);
      setFirmwareUrl("");
      setToast(result.accepted ? "UpdateFirmware accepted by charger" : "Charger rejected firmware update");
      setTimeout(() => setToast(null), 4000);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Firmware update failed";
      if (e instanceof OcppGatewayError && message.includes("not configured")) {
        void notifyFirmwareAlert(charger.chargePointId, "failed", message).catch(() => {});
      }
      setToast(message);
      setTimeout(() => setToast(null), 4000);
    } finally {
      setFirmwareLoading(false);
    }
  };

  const handleRemoteAction = (type: string, connectorId: number) => {
    setActionModal({ type, connectorId });
    setActionResult(null);
  };

  const confirmAction = async () => {
    if (!actionModal || !charger) return;
    const { type, connectorId } = actionModal;
    setActionLoading(true);
    setActionModal(null);

    try {
      if (type === "RemoteStart") {
        const idTag = prompt("Enter RFID idTag for remote start:", "RFID-DFCCIL-001");
        if (!idTag?.trim()) {
          setActionResult({ success: false, message: "Remote start cancelled — idTag required" });
          return;
        }
        const result = await ocppService.remoteStartTransaction({
          chargePointId: charger.chargePointId,
          connectorId,
          idTag: idTag.trim(),
        });
        setActionResult({
          success: result.accepted,
          message: result.accepted
            ? `RemoteStart sent to Gun ${connectorId}. Awaiting charger response…`
            : `RemoteStart rejected by charger on Gun ${connectorId}`,
        });
      } else if (type === "RemoteStop") {
        const session = sessions.find((s) => s.connectorId === connectorId);
        if (!session?.transactionId) {
          setActionResult({
            success: false,
            message: `No active session on Gun ${connectorId} to stop`,
          });
          return;
        }
        const result = await ocppService.remoteStopTransaction({
          chargePointId: charger.chargePointId,
          transactionId: session.transactionId,
        });
        setActionResult({
          success: result.accepted,
          message: result.accepted
            ? `RemoteStop sent for transaction ${session.transactionId}`
            : `RemoteStop rejected by charger`,
        });
      } else if (type === "Reset") {
        await ocppService.resetCharger(charger.chargePointId, connectorId === 0 ? "Hard" : "Soft");
        setActionResult({
          success: true,
          message:
            connectorId === 0
              ? "Hard reset command sent to charger"
              : `Soft reset command sent (Gun ${connectorId} context)`,
        });
      } else if (type === "Unlock") {
        const result = await ocppService.unlockConnector(charger.chargePointId, connectorId);
        setActionResult({
          success: result.accepted,
          message: result.accepted
            ? `Unlock command sent to Gun ${connectorId}`
            : `Unlock rejected by charger on Gun ${connectorId}`,
        });
      }
      reloadChargerData();
    } catch (e) {
      setActionResult({
        success: false,
        message: e instanceof Error ? e.message : "OCPP command failed — is the gateway running?",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const connectorActions = [
    { type: "RemoteStart", label: "Start", icon: "ri-play-circle-line", color: "text-emerald-600 bg-emerald-50 hover:bg-emerald-100" },
    { type: "RemoteStop", label: "Stop", icon: "ri-stop-circle-line", color: "text-red-500 bg-red-50 hover:bg-red-100" },
    { type: "Reset", label: "Reset", icon: "ri-restart-line", color: "text-amber-600 bg-amber-50 hover:bg-amber-100" },
    { type: "Unlock", label: "Unlock", icon: "ri-lock-unlock-line", color: "text-gray-600 bg-gray-50 hover:bg-gray-100" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/chargers")}
          className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white border border-gray-200 transition-colors"
        >
          <i className="ri-arrow-left-line text-gray-500"></i>
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            {charger.name}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-500">{charger.chargePointId}</span>
            <span className="text-gray-300">·</span>
            <span className="text-xs text-gray-500">{charger.manufacturer}</span>
            <span className="text-gray-300">·</span>
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${getConnectivityColor(connectivityLabel)}`}></div>
              <span className={`text-xs font-medium capitalize ${getConnectivityTextClass(connectivityLabel)}`}>
                {connectivityLabel}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {charger.status === "decommissioned" ? (
            <span className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-medium">Decommissioned</span>
          ) : null}
          <button
            onClick={() => setShowEditModal(true)}
            disabled={charger.status === "decommissioned"}
            className="px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors whitespace-nowrap flex items-center gap-2 disabled:opacity-50"
          >
            <i className="ri-edit-line"></i>
            Edit
          </button>
          <button
            onClick={() => setShowFirmwareModal(true)}
            disabled={charger.status === "decommissioned"}
            className="px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors whitespace-nowrap flex items-center gap-2 disabled:opacity-50"
          >
            <i className="ri-download-cloud-line"></i>
            Firmware
          </button>
          <button
            onClick={() => handleRemoteAction("Reset", 0)}
            disabled={charger.status === "decommissioned"}
            className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors whitespace-nowrap flex items-center gap-2 disabled:opacity-50"
          >
          <div className="w-4 h-4 flex items-center justify-center">
            <i className="ri-restart-line"></i>
          </div>
          Reset Charger
          </button>
          {charger.status !== "decommissioned" ? (
            <button
              onClick={() => setShowDecommissionConfirm(true)}
              className="px-4 py-2 bg-white text-red-600 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors whitespace-nowrap flex items-center gap-2"
            >
              <i className="ri-archive-line"></i>
              Decommission
            </button>
          ) : null}
        </div>
      </div>

      {toast && (
        <div className="fixed top-20 right-6 z-50 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm shadow-lg">
          {toast}
        </div>
      )}

      <ChargerFormModal
        open={showEditModal}
        mode="edit"
        editingId={charger.id}
        initialForm={chargerToForm(charger)}
        onClose={() => setShowEditModal(false)}
        onSaved={() => {
          reloadChargerData();
          setToast("Charger updated successfully");
          setTimeout(() => setToast(null), 3000);
        }}
        onError={(msg) => {
          setToast(msg);
          setTimeout(() => setToast(null), 3000);
        }}
      />

      {showFirmwareModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !firmwareLoading && setShowFirmwareModal(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
              <h4 className="text-sm font-semibold text-gray-900 mb-1">OCPP UpdateFirmware</h4>
              <p className="text-xs text-gray-500 mb-4">Send firmware package URL to {charger.chargePointId}</p>
              <input
                type="url"
                value={firmwareUrl}
                onChange={(e) => setFirmwareUrl(e.target.value)}
                placeholder="https://cdn.example.com/firmware/v2.5.0.bin"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-4"
              />
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowFirmwareModal(false)}
                  disabled={firmwareLoading}
                  className="px-4 py-2 text-sm text-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleFirmwareUpdate()}
                  disabled={firmwareLoading || !firmwareUrl.trim()}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-60"
                >
                  {firmwareLoading ? "Sending…" : "Send Update"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {actionResult && (
        <div
          className={`p-4 rounded-xl border ${
            actionResult.success
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 flex items-center justify-center">
              <i className={actionResult.success ? "ri-checkbox-circle-line" : "ri-close-circle-line"}></i>
            </div>
            <p className="text-sm font-medium">{actionResult.message}</p>
            <button
              onClick={() => setActionResult(null)}
              className="ml-auto w-6 h-6 flex items-center justify-center rounded hover:bg-black/10 transition-colors"
            >
              <i className="ri-close-line text-sm"></i>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Charger Information</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-1">Manufacturer</p>
                <p className="text-sm font-medium text-gray-900">{charger.manufacturer}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Model</p>
                <p className="text-sm font-medium text-gray-900">{charger.model}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Serial Number</p>
                <p className="text-sm font-medium text-gray-900">{charger.serialNumber}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Firmware Version</p>
                <p className="text-sm font-medium text-gray-900">{charger.firmwareVersion}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Max Power</p>
                <p className="text-sm font-medium text-gray-900">{charger.maxPowerKw} kW</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Charger Type</p>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    charger.type === "DC Fast"
                      ? "bg-amber-50 text-amber-700 border border-amber-200"
                      : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}
                >
                  {charger.type}
                </span>
              </div>
              <div className="sm:col-span-3">
                <p className="text-xs text-gray-400 mb-1">Location</p>
                <p className="text-sm font-medium text-gray-900">{charger.location}</p>
              </div>
              <div className="sm:col-span-3">
                <p className="text-xs text-gray-400 mb-1">Billing Tariff</p>
                {effectiveTariff ? (
                  <>
                    <p className="text-sm font-medium text-gray-900">{effectiveTariff.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{tariffService.formatTariffSummary(effectiveTariff)}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {charger.tariff ? "Custom tariff assigned to this charger" : `Type default for ${charger.type}`}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-amber-600">No active tariff — assign one in Tariffs or Edit charger</p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Last Heartbeat</p>
                <p className="text-sm font-medium text-gray-900">{formatHeartbeatAgo(charger.lastHeartbeat)}</p>
              </div>
              <div className="sm:col-span-3">
                <p className="text-xs text-gray-400 mb-1">OCPP WebSocket</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      ocppSocketLive ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {ocppSocketLive ? "Socket connected" : "Socket not connected"}
                  </span>
                  <code className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded break-all flex-1 min-w-0">
                    {buildOcppWebSocketUrl(charger.chargePointId)}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(buildOcppWebSocketUrl(charger.chargePointId));
                    }}
                    className="text-xs text-emerald-600 hover:text-emerald-700 font-medium whitespace-nowrap"
                  >
                    Copy URL
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  Unique per charger — use this URL on the physical unit or simulator. Path pattern: /ocpp/{"{chargePointId}"}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Connectors &amp; Remote Commands</h3>
            <div className="space-y-3">
              {charger.connectors.map((conn) => (
                <div
                  key={conn.id}
                  className={`p-4 rounded-lg border transition-colors ${
                    selectedConnector === conn.connectorId ? "border-emerald-300 bg-emerald-50/50" : "border-gray-200 bg-gray-50/50"
                  }`}
                  onClick={() => setSelectedConnector(conn.connectorId)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-white border border-gray-200 flex-shrink-0">
                        <i className="ri-plug-line text-gray-600"></i>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          Gun {conn.connectorId} — {conn.type}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              conn.status === "Charging"
                                ? "bg-emerald-100 text-emerald-700"
                                : conn.status === "Available"
                                ? "bg-gray-100 text-gray-600"
                                : conn.status === "Faulted"
                                ? "bg-red-100 text-red-700"
                                : "bg-gray-100 text-gray-400"
                            }`}
                          >
                            {conn.status}
                          </span>
                          <span className="text-xs text-gray-400">{conn.maxPowerKw} kW max</span>
                        </div>
                      </div>
                    </div>
                    {conn.status === "Charging" && (
                      <div className="flex items-center gap-1">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span className="text-xs text-emerald-600 font-medium">Live</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {connectorActions.map((action) => (
                      <button
                        key={action.type}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoteAction(action.type, conn.connectorId);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${action.color}`}
                      >
                        <div className="w-3.5 h-3.5 flex items-center justify-center">
                          <i className={action.icon}></i>
                        </div>
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Active Sessions</h3>
            {sessions.length > 0 ? (
              <div className="space-y-3">
                {sessions.map((session) => (
                  <div key={session.id} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
                    <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-100 flex-shrink-0 mt-0.5">
                      <i className="ri-flashlight-fill text-emerald-600 text-sm"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{session.userName}</p>
                      <p className="text-xs text-gray-400">Gun {session.connectorId} · {session.connectorType}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-xs font-semibold text-gray-700">{session.energyKwh} kWh</span>
                        <span className="text-xs text-gray-400">{session.duration}</span>
                        <span className="text-xs text-gray-400">SoC {session.soc}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 mx-auto mb-2">
                  <i className="ri-plug-line text-gray-300"></i>
                </div>
                <p className="text-xs text-gray-400">No active sessions</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">OCPP Messages</h3>
              <div className="flex items-center gap-1 bg-[#f5f5f3] rounded-lg p-0.5">
                <button
                  onClick={() => setOcppTab("recent")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    ocppTab === "recent" ? "bg-white text-gray-900" : "text-gray-500"
                  }`}
                >
                  Recent
                </button>
                <button
                  onClick={() => setOcppTab("all")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    ocppTab === "all" ? "bg-white text-gray-900" : "text-gray-500"
                  }`}
                >
                  All
                </button>
              </div>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {ocppMessages.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">No OCPP events recorded for this charger</p>
              ) : null}
              {ocppMessages.map((msg) => (
                <div key={msg.id} className="flex items-start gap-2 py-1.5">
                  <div
                    className={`w-5 h-5 flex items-center justify-center rounded flex-shrink-0 mt-0.5 ${
                      msg.direction === "in" ? "bg-emerald-100" : "bg-amber-100"
                    }`}
                  >
                    <i
                      className={`text-xs ${
                        msg.direction === "in" ? "ri-arrow-down-line text-emerald-600" : "ri-arrow-up-line text-amber-600"
                      }`}
                    ></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900">{msg.message}</p>
                    <p className="text-[10px] text-gray-400 truncate">{msg.details}</p>
                    <p className="text-[10px] text-gray-300">{getRelativeTime(msg.time)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {actionModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setActionModal(null)}></div>
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-amber-100">
                  <i className="ri-alert-line text-amber-600 text-lg"></i>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">Confirm Remote Command</h4>
                  <p className="text-xs text-gray-500">This action will be sent to the charger</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Command</span>
                  <span className="text-xs font-semibold text-gray-900">{actionModal.type}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-500">Target</span>
                  <span className="text-xs font-semibold text-gray-900">
                    {actionModal.connectorId === 0 ? "Entire Charger" : `Gun ${actionModal.connectorId}`}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-500">Charger</span>
                  <span className="text-xs font-semibold text-gray-900">{charger.chargePointId}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setActionModal(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmAction}
                  disabled={actionLoading}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap disabled:opacity-60"
                >
                  {actionLoading ? "Sending…" : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {showDecommissionConfirm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !decommissionLoading && setShowDecommissionConfirm(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
              <h4 className="text-lg font-semibold text-gray-900 mb-2">Decommission this charger?</h4>
              <p className="text-sm text-gray-600 mb-4">
                {charger.name} will be removed from the active fleet. OCPP remote commands will be disabled. Session history is retained.
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={decommissionLoading}
                  onClick={() => setShowDecommissionConfirm(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={decommissionLoading}
                  onClick={handleDecommission}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-60 transition-colors"
                >
                  {decommissionLoading ? "Decommissioning…" : "Decommission"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}