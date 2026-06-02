import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAsyncData } from "@/hooks/useAsyncData";
import * as chargerService from "@/services/chargerService";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

type StatusFilter = "all" | "online" | "offline" | "faulted";
type TypeFilter = "all" | "DC Fast" | "AC Slow";

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

function getConnectorBadge(status: string): string {
  switch (status) {
    case "Charging":
      return "bg-emerald-100 text-emerald-700";
    case "Available":
      return "bg-gray-100 text-gray-600";
    case "Faulted":
      return "bg-red-100 text-red-700";
    case "Unavailable":
      return "bg-gray-100 text-gray-400";
    default:
      return "bg-gray-100 text-gray-500";
  }
}

export default function ChargersPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [manufacturerFilter, setManufacturerFilter] = useState<string>("all");
  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  const { data: chargersData } = useAsyncData(
    () =>
      chargerService.getChargers({
        status: statusFilter,
        type: typeFilter,
        manufacturer: manufacturerFilter,
        search: debouncedSearch,
      }),
    [statusFilter, typeFilter, manufacturerFilter, debouncedSearch]
  );
  const { data: sessionsData } = useAsyncData(() => chargerService.getActiveSessionsForChargers(), []);
  const mockChargers = chargersData ?? [];
  const mockActiveSessions = sessionsData ?? [];

  const stats = useMemo(() => {
    const online = mockChargers.filter((c) => c.status === "online").length;
    const offline = mockChargers.filter((c) => c.status === "offline").length;
    const faulted = mockChargers.filter((c) => c.status === "faulted").length;
    const chargingConnectors = mockChargers.reduce(
      (acc, c) => acc + c.connectors.filter((conn) => conn.status === "Charging").length,
      0,
    );
    return { online, offline, faulted, chargingConnectors };
  }, [mockChargers]);

  const filteredChargers = useMemo(() => mockChargers, [mockChargers]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Charger Management
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Monitor and manage {mockChargers.length > 0 ? `all ${mockChargers.length}` : ""} EV chargers across DFCCIL sites
        </p>
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
                {(["all", "online", "offline", "faulted"] as StatusFilter[]).map((f) => (
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
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Charger</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Type</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Location</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Connectors</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Last Heartbeat</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredChargers.map((charger) => (
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
                    <div className="flex items-center gap-1.5">
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
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm text-gray-700">{charger.location}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {charger.connectors.map((conn) => (
                        <span key={conn.id} className={`text-xs px-2 py-0.5 rounded-full font-medium ${getConnectorBadge(conn.status)}`}>
                          G{conn.connectorId}: {conn.status}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-xs text-gray-500">{getRelativeTime(charger.lastHeartbeat)}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1">
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
      </div>
    </div>
  );
}