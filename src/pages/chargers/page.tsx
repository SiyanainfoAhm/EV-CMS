import { useState, useMemo, useEffect } from "react";

import { useNavigate } from "react-router-dom";

import { useAsyncData } from "@/hooks/useAsyncData";

import { useSupabaseRealtime } from "@/hooks/useSupabaseRealtime";

import * as chargerService from "@/services/chargerService";

import * as ocppService from "@/services/ocppService";

import { useDebouncedValue } from "@/hooks/useDebouncedValue";

import {

  ChargerFormModal,

  chargerToForm,

  emptyChargerForm,

} from "@/components/chargers/ChargerFormModal";

import type { ChargerFormFields } from "@/utils/validation";

import {

  formatHeartbeatAgo,

  heartbeatAgeMs,

  isOfflineByStatus,

  isOnlineByStatus,

} from "@/utils/chargerConnectivity";

import {
  connectorStatusBadgeClass,
  connectorStatusLabel,
  isConnectorCharging,
} from "@/utils/connectorStatus";

import type { Charger } from "@/types/ev";

function tariffLabel(charger: Charger): string {
  if (charger.tariff) return charger.tariff.name;
  return `Type default (${charger.type})`;
}



type StatusFilter = "all" | "online" | "offline" | "faulted" | "decommissioned";

type TypeFilter = "all" | "DC Fast" | "AC Slow";

/** Add Charger — local dev only; stripped from production builds (Vercel live). */
const SHOW_ADD_CHARGER_BUTTON = import.meta.env.DEV;

type SortKey = "name" | "type" | "ocpp" | "status" | "location" | "tariff" | "lastHeartbeat";

const PER_PAGE = 10;

const STATUS_SORT_ORDER: Record<string, number> = {
  online: 0,
  available: 0,
  faulted: 1,
  offline: 2,
  decommissioned: 3,
};

function compareChargers(
  a: Charger,
  b: Charger,
  key: SortKey,
  ocppConnectedIds: Set<string>
): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    case "type":
      return a.type.localeCompare(b.type, undefined, { sensitivity: "base" });
    case "ocpp": {
      const aLive = ocppConnectedIds.has(a.chargePointId.toUpperCase()) ? 1 : 0;
      const bLive = ocppConnectedIds.has(b.chargePointId.toUpperCase()) ? 1 : 0;
      return aLive - bLive;
    }
    case "status": {
      const aKey = String(a.status || "").toLowerCase();
      const bKey = String(b.status || "").toLowerCase();
      return (STATUS_SORT_ORDER[aKey] ?? 99) - (STATUS_SORT_ORDER[bKey] ?? 99);
    }
    case "location":
      return a.location.localeCompare(b.location, undefined, { sensitivity: "base" });
    case "tariff":
      return tariffLabel(a).localeCompare(tariffLabel(b), undefined, { sensitivity: "base" });
    case "lastHeartbeat":
      // Newer heartbeat first when ascending age (smaller age = more recent)
      return heartbeatAgeMs(a.lastHeartbeat) - heartbeatAgeMs(b.lastHeartbeat);
    default:
      return 0;
  }
}

export default function ChargersPage() {

  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState("");

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const [manufacturerFilter, setManufacturerFilter] = useState<string>("all");

  const [modalMode, setModalMode] = useState<"add" | "edit" | null>(null);

  const [decommissionTarget, setDecommissionTarget] = useState<Charger | null>(null);
  const [decommissionLoading, setDecommissionLoading] = useState(false);

  const [editingCharger, setEditingCharger] = useState<Charger | null>(null);

  const [formInitial, setFormInitial] = useState<ChargerFormFields>(emptyChargerForm);

  const [toast, setToast] = useState<string | null>(null);

  const [ocppConnectedIds, setOcppConnectedIds] = useState<Set<string>>(new Set());

  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const debouncedSearch = useDebouncedValue(searchQuery, 250);



  const showToast = (msg: string) => {

    setToast(msg);

    setTimeout(() => setToast(null), 3000);

  };



  const openAddModal = () => {

    setEditingCharger(null);

    setFormInitial(emptyChargerForm);

    setModalMode("add");

  };



  const openEditModal = (charger: Charger) => {

    setEditingCharger(charger);

    setFormInitial(chargerToForm(charger));

    setModalMode("edit");

  };



  const closeModal = () => {

    setModalMode(null);

    setEditingCharger(null);

    setFormInitial(emptyChargerForm);

  };

  const confirmDecommission = async () => {
    if (!decommissionTarget) return;
    setDecommissionLoading(true);
    try {
      await chargerService.decommissionCharger(decommissionTarget.id);
      setDecommissionTarget(null);
      await reloadChargers();
      showToast(`${decommissionTarget.name} decommissioned`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Decommission failed");
    } finally {
      setDecommissionLoading(false);
    }
  };



  useEffect(() => {

    const loadFleet = () => {

      ocppService.getOcppFleet().then((fleet) => {

        setOcppConnectedIds(new Set(fleet.chargers.filter((c) => c.ocppConnected).map((c) => c.chargePointId)));

      });

    };

    loadFleet();

    const timer = setInterval(loadFleet, 30000);

    return () => clearInterval(timer);

  }, []);



  const apiStatus =
    statusFilter === "online" || statusFilter === "offline"
      ? "all"
      : statusFilter === "decommissioned"
        ? "decommissioned"
        : statusFilter;



  const { data: chargersData, reload: reloadChargers } = useAsyncData(

    () =>

      chargerService.getChargers({

        status: apiStatus,

        type: typeFilter,

        manufacturer: manufacturerFilter,

        search: debouncedSearch,

      }),

    [apiStatus, typeFilter, manufacturerFilter, debouncedSearch]

  );

  const { data: sessionsData, reload: reloadSessions } = useAsyncData(

    () => chargerService.getActiveSessionsForChargers(),

    []

  );



  useSupabaseRealtime(() => {

    reloadChargers();

    reloadSessions();

  });



  const mockChargers = chargersData ?? [];

  const mockActiveSessions = sessionsData ?? [];

  useEffect(() => {
    if (mockChargers.length > 0) {
      console.log('[web chargers/status]', mockChargers.map((c) => ({
        id: c.chargePointId,
        status: c.status,
        normalizedStatus: String(c.status || '').toLowerCase().trim(),
        connectors: c.connectors?.map((x) => x.status),
      })));
    }
  }, [mockChargers]);



  const stats = useMemo(() => {

    const online = mockChargers.filter((c) => isOnlineByStatus(c.status)).length;

    const offline = mockChargers.filter((c) => isOfflineByStatus(c.status)).length;

    const FAULTED_STATUSES = new Set(["faulted", "error", "unavailable"]);
    const faulted = mockChargers.filter((c) => FAULTED_STATUSES.has(String(c.status || "").toLowerCase().trim())).length;

    const chargingConnectors = mockChargers.reduce(

      (acc, c) => acc + c.connectors.filter((conn) => isConnectorCharging(conn.status)).length,

      0,

    );

    return { online, offline, faulted, chargingConnectors };

  }, [mockChargers]);



  const filteredChargers = useMemo(() => {

    return mockChargers.filter((c) => {

      if (statusFilter === "online") return isOnlineByStatus(c.status);

      if (statusFilter === "offline") return isOfflineByStatus(c.status);

      if (statusFilter === "faulted") return ["faulted", "error", "unavailable"].includes(String(c.status || "").toLowerCase().trim());

      if (statusFilter === "decommissioned") return c.status === "decommissioned";

      return true;

    });

  }, [mockChargers, statusFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, typeFilter, manufacturerFilter, debouncedSearch]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "lastHeartbeat" || key === "ocpp" ? "desc" : "asc");
    }
    setCurrentPage(1);
  };

  const sortedChargers = useMemo(() => {
    const rows = [...filteredChargers];
    rows.sort((a, b) => {
      const cmp = compareChargers(a, b, sortKey, ocppConnectedIds);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filteredChargers, sortKey, sortDir, ocppConnectedIds]);

  const totalPages = Math.max(1, Math.ceil(sortedChargers.length / PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedChargers = sortedChargers.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return "ri-arrow-up-down-line text-gray-300";
    return sortDir === "asc" ? "ri-arrow-up-s-line text-emerald-600" : "ri-arrow-down-s-line text-emerald-600";
  };

  const renderSortHeader = (label: string, column: SortKey, className: string) => (
    <th className={className}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleSort(column);
        }}
        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-gray-600 transition-colors"
      >
        {label}
        <i className={`${sortIcon(column)} text-sm`}></i>
      </button>
    </th>
  );

  const handleSaved = async (saved: Charger) => {

    await reloadChargers();

    showToast(modalMode === "edit" ? "Charger updated successfully" : "Charger added successfully");

    if (modalMode === "add") {

      navigate(`/chargers/${saved.id}`);

    }

  };



  return (

    <div className="space-y-5">

      {toast && (

        <div className="fixed top-20 right-6 z-50 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm shadow-lg">

          {toast}

        </div>

      )}



      <div className="flex items-center justify-between gap-4">

        <div>

          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>

            Charger Management

          </h1>

          <p className="text-sm text-gray-500 mt-1">

            Monitor and manage {mockChargers.length > 0 ? `all ${mockChargers.length}` : ""} EV chargers — add more anytime via OCPP

          </p>

        </div>

        {SHOW_ADD_CHARGER_BUTTON && (
          <button
            onClick={openAddModal}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap flex items-center gap-2"
          >
            <i className="ri-add-line"></i>
            Add Charger
          </button>
        )}
      </div>



      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

        <div className="bg-white rounded-xl border border-gray-200 p-4">

          <div className="flex items-center gap-2 mb-2">

            <div className="w-3 h-3 rounded-full bg-emerald-500 flex-shrink-0"></div>

            <span className="text-xs text-gray-500">Online</span>

          </div>

          <p className="text-2xl font-bold text-gray-900">{stats.online}</p>

        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">

          <div className="flex items-center gap-2 mb-2">

            <div className="w-3 h-3 rounded-full bg-gray-400 flex-shrink-0"></div>

            <span className="text-xs text-gray-500">Offline</span>

          </div>

          <p className="text-2xl font-bold text-gray-900">{stats.offline}</p>

        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">

          <div className="flex items-center gap-2 mb-2">

            <div className="w-3 h-3 rounded-full bg-red-500 flex-shrink-0"></div>

            <span className="text-xs text-gray-500">Faulted</span>

          </div>

          <p className="text-2xl font-bold text-gray-900">{stats.faulted}</p>

        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">

          <div className="flex items-center gap-2 mb-2">

            <i className="ri-flashlight-fill text-amber-600 text-sm"></i>

            <span className="text-xs text-gray-500">Charging Now</span>

          </div>

          <p className="text-2xl font-bold text-gray-900">{stats.chargingConnectors}</p>

        </div>

      </div>



      <div className="bg-white rounded-xl border border-gray-200">

        <div className="p-4 border-b border-gray-200">

          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">

            <div className="flex items-center gap-2 flex-wrap">

              <div className="relative">

                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>

                <input

                  type="text"

                  placeholder="Search by name, ID or location..."

                  value={searchQuery}

                  onChange={(e) => setSearchQuery(e.target.value)}

                  className="pl-9 pr-4 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"

                />

              </div>



              <div className="flex items-center gap-1.5 bg-[#f5f5f3] rounded-lg p-1">

                {(["all", "online", "offline", "faulted", "decommissioned"] as StatusFilter[]).map((f) => (

                  <button

                    key={f}

                    onClick={() => setStatusFilter(f)}

                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${

                      statusFilter === f ? "bg-emerald-600 text-white" : "text-gray-500 hover:text-gray-700"

                    }`}

                  >

                    {f === "all" ? "All Status" : f.charAt(0).toUpperCase() + f.slice(1)}

                  </button>

                ))}

              </div>



              <select

                value={typeFilter}

                onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}

                className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"

              >

                <option value="all">All Types</option>

                <option value="DC Fast">DC Fast</option>

                <option value="AC Slow">AC Slow</option>

              </select>



              <select

                value={manufacturerFilter}

                onChange={(e) => setManufacturerFilter(e.target.value)}

                className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"

              >

                <option value="all">All Manufacturers</option>

                <option value="MyPower Experts">MyPower Experts</option>

                <option value="Tri Square">Tri Square</option>

              </select>

            </div>



            <p className="text-xs text-gray-400">

              Showing {filteredChargers.length} of {mockChargers.length} chargers

            </p>

          </div>

        </div>



        <div className="overflow-x-auto">

          <table className="w-full">

            <thead>

              <tr className="border-b border-gray-100">

                {renderSortHeader("Charger", "name", "text-left px-5 py-3 text-xs font-medium text-gray-400")}

                {renderSortHeader("Type", "type", "text-left px-5 py-3 text-xs font-medium text-gray-400")}

                {renderSortHeader("OCPP", "ocpp", "text-left px-5 py-3 text-xs font-medium text-gray-400")}

                {renderSortHeader("Status", "status", "text-left px-5 py-3 text-xs font-medium text-gray-400")}

                {renderSortHeader("Location", "location", "text-left px-5 py-3 text-xs font-medium text-gray-400")}

                {renderSortHeader("Tariff", "tariff", "text-left px-5 py-3 text-xs font-medium text-gray-400")}

                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Connectors</th>

                {renderSortHeader("Last Heartbeat", "lastHeartbeat", "text-left px-5 py-3 text-xs font-medium text-gray-400")}

                <th className="text-right px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>

              </tr>

            </thead>

            <tbody>

              {paginatedChargers.map((charger) => (

                <tr

                  key={charger.id}

                  className="border-b border-gray-50 hover:bg-[#f9faf7] transition-colors cursor-pointer"

                  onClick={() => navigate(`/chargers/${charger.id}`)}

                >

                  <td className="px-5 py-3.5">

                    <div className="flex items-center gap-3">

                      <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-100 flex-shrink-0">

                        <i

                          className={`text-sm ${

                            charger.type === "DC Fast" ? "ri-flashlight-fill text-amber-500" : "ri-plug-line text-emerald-600"

                          }`}

                        ></i>

                      </div>

                      <div>

                        <p className="text-sm font-medium text-gray-900">{charger.name}</p>

                        <p className="text-xs text-gray-400">{charger.chargePointId} · {charger.manufacturer}</p>

                      </div>

                    </div>

                  </td>

                  <td className="px-5 py-3.5">

                    <span

                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${

                        charger.type === "DC Fast"

                          ? "bg-amber-50 text-amber-700 border border-amber-200"

                          : "bg-emerald-50 text-emerald-700 border border-emerald-200"

                      }`}

                    >

                      {charger.type}

                    </span>

                  </td>

                  <td className="px-5 py-3.5">

                    <span

                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${

                        ocppConnectedIds.has(charger.chargePointId.toUpperCase())

                          ? "bg-blue-50 text-blue-700 border border-blue-200"

                          : "bg-gray-100 text-gray-500"

                      }`}

                    >

                      {ocppConnectedIds.has(charger.chargePointId.toUpperCase()) ? "Socket live" : "Socket off"}

                    </span>

                  </td>

                  <td className="px-5 py-3.5">

                    <div className="flex items-center gap-1.5">

                      <div

                        className={`w-2 h-2 rounded-full ${
                          isOnlineByStatus(charger.status)
                            ? "bg-emerald-500"
                            : isOfflineByStatus(charger.status)
                              ? "bg-gray-400"
                              : ["faulted", "error", "unavailable"].includes(String(charger.status || "").toLowerCase().trim())
                                ? "bg-red-500"
                                : "bg-amber-400"
                        }`}

                      ></div>

                      <span className="text-xs font-medium text-gray-700 capitalize">

                        {String(charger.status || "unknown").toLowerCase()}

                      </span>

                    </div>

                  </td>

                  <td className="px-5 py-3.5">

                    <p className="text-sm text-gray-700">{charger.location}</p>

                  </td>

                  <td className="px-5 py-3.5">

                    <p className="text-xs font-medium text-gray-700">{tariffLabel(charger)}</p>

                    {charger.tariff ? (
                      <p className="text-xs text-gray-400 mt-0.5">Custom</p>
                    ) : null}

                  </td>

                  <td className="px-5 py-3.5">

                    <div className="flex items-center gap-1.5 flex-wrap">

                      {charger.connectors.map((conn) => (

                        <span key={conn.id} className={`text-xs px-2 py-0.5 rounded-full font-medium ${connectorStatusBadgeClass(conn.status)}`}>

                          G{conn.connectorId}: {connectorStatusLabel(conn.status)}

                        </span>

                      ))}

                    </div>

                  </td>

                  <td className="px-5 py-3.5">

                    <p className="text-xs text-gray-500">{formatHeartbeatAgo(charger.lastHeartbeat)}</p>

                  </td>

                  <td className="px-5 py-3.5">

                    <div className="flex items-center justify-end gap-1">

                      <button

                        onClick={(e) => {

                          e.stopPropagation();

                          openEditModal(charger);

                        }}

                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"

                        title="Edit charger"

                      >

                        <i className="ri-edit-line text-gray-400"></i>

                      </button>

                      {charger.status !== "decommissioned" ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDecommissionTarget(charger);
                          }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors"
                          title="Decommission charger"
                        >
                          <i className="ri-archive-line text-red-400"></i>
                        </button>
                      ) : null}

                      <button

                        onClick={(e) => {

                          e.stopPropagation();

                          navigate(`/chargers/${charger.id}`);

                        }}

                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"

                        title="View details"

                      >

                        <i className="ri-arrow-right-s-line text-gray-400"></i>

                      </button>

                    </div>

                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        </div>



        {filteredChargers.length === 0 && (

          <div className="py-16 text-center">

            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-gray-100 mx-auto mb-3">

              <i className="ri-search-line text-gray-300 text-xl"></i>

            </div>

            <p className="text-sm text-gray-400">No chargers match your filters</p>

            <button

              onClick={() => {

                setSearchQuery("");

                setStatusFilter("all");

                setTypeFilter("all");

                setManufacturerFilter("all");

              }}

              className="mt-2 text-xs text-emerald-600 hover:text-emerald-700 font-medium whitespace-nowrap"

            >

              Clear all filters

            </button>

          </div>

        )}

        {filteredChargers.length > 0 && totalPages > 1 && (
          <div className="p-4 border-t border-gray-200 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              Showing {(safePage - 1) * PER_PAGE + 1}-{Math.min(safePage * PER_PAGE, sortedChargers.length)} of{" "}
              {sortedChargers.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
                disabled={safePage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <i className="ri-arrow-left-s-line text-gray-500"></i>
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setCurrentPage(p)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                    safePage === p ? "bg-emerald-600 text-white" : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
                disabled={safePage === totalPages}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <i className="ri-arrow-right-s-line text-gray-500"></i>
              </button>
            </div>
          </div>
        )}

      </div>



      <ChargerFormModal

        open={modalMode !== null}

        mode={modalMode === "edit" ? "edit" : "add"}

        editingId={editingCharger?.id}

        initialForm={formInitial}

        onClose={closeModal}

        onSaved={handleSaved}

        onError={(msg) => showToast(msg)}

      />

      {decommissionTarget && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !decommissionLoading && setDecommissionTarget(null)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
              <h4 className="text-lg font-semibold text-gray-900 mb-2">Decommission charger?</h4>
              <p className="text-sm text-gray-600 mb-4">
                <span className="font-medium">{decommissionTarget.name}</span> ({decommissionTarget.chargePointId})
                will be marked decommissioned and hidden from the active fleet list. Historical sessions are kept.
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={decommissionLoading}
                  onClick={() => setDecommissionTarget(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={decommissionLoading}
                  onClick={confirmDecommission}
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


