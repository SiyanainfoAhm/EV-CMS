import { useState, useMemo, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as chargerService from "@/services/chargerService";
import type { Charger, ChargingSession } from "@/types/ev";

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

function getStatusColor(status: string): string {
  switch (status) {
    case "online":
      return "bg-emerald-500";
    case "offline":
      return "bg-gray-400";
    case "faulted":
      return "bg-red-500";
    default:
      return "bg-gray-400";
  }
}

export default function ChargerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [charger, setCharger] = useState<Charger | undefined>();
  const [mockActiveSessions, setMockActiveSessions] = useState<ChargingSession[]>([]);
  const [ocppEvents, setOcppEvents] = useState<chargerService.ChargerEvent[]>([]);
  const [ocppTab, setOcppTab] = useState<"recent" | "all">("recent");

  useEffect(() => {
    if (!id) return;
    chargerService.getChargerById(id).then(setCharger);
    chargerService.getActiveSessionsForChargers().then(setMockActiveSessions);
    chargerService.getChargerEvents(id).then(setOcppEvents);
  }, [id]);

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

  const handleRemoteAction = (type: string, connectorId: number) => {
    setActionModal({ type, connectorId });
    setActionResult(null);
  };

  const confirmAction = () => {
    if (!actionModal) return;
    const { type, connectorId } = actionModal;
    setActionResult({
      success: true,
      message: `${type} command sent to Gun ${connectorId}. Awaiting charger response...`,
    });
    setActionModal(null);
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
              <div className={`w-2 h-2 rounded-full ${getStatusColor(charger.status)}`}></div>
              <span
                className={`text-xs font-medium ${
                  charger.status === "online"
                    ? "text-emerald-600"
                    : charger.status === "faulted"
                    ? "text-red-500"
                    : "text-gray-500"
                }`}
              >
                {charger.status.charAt(0).toUpperCase() + charger.status.slice(1)}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={() => handleRemoteAction("Reset", 0)}
          className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors whitespace-nowrap flex items-center gap-2"
        >
          <div className="w-4 h-4 flex items-center justify-center">
            <i className="ri-restart-line"></i>
          </div>
          Reset Charger
        </button>
      </div>

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
              <div>
                <p className="text-xs text-gray-400 mb-1">Last Heartbeat</p>
                <p className="text-sm font-medium text-gray-900">{getRelativeTime(charger.lastHeartbeat)}</p>
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
                  className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}