import { useState, useMemo, useEffect } from "react";
import * as auditLogService from "@/services/auditLogService";
import type { AuditLog } from "@/types/ev";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [allLogsForFacets, setAllLogsForFacets] = useState<AuditLog[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const perPage = 10;
  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  // Load facet options once (users/actions).
  useEffect(() => {
    auditLogService
      .getAuditLogs({ limit: 500 })
      .then((data) =>
        setAllLogsForFacets([...data].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))
      )
      .catch(console.error);
  }, []);

  // Fetch filtered logs from server when filters/search change.
  useEffect(() => {
    auditLogService
      .getAuditLogs({ action: actionFilter, search: debouncedSearch, limit: 500 })
      .then((data) =>
        setLogs([...data].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))
      )
      .catch(console.error);
  }, [actionFilter, debouncedSearch]);

  const uniqueUsers = useMemo(() => {
    const names = [...new Set(allLogsForFacets.map((l) => l.userName))];
    return names;
  }, [allLogsForFacets]);

  const uniqueActions = useMemo(() => {
    const actions = [...new Set(allLogsForFacets.map((l) => l.action))];
    return actions;
  }, [allLogsForFacets]);

  const filteredLogs = useMemo(() => {
    // `action` + `search` are applied server-side.
    if (userFilter === "all") return logs;
    return logs.filter((l) => l.userName === userFilter);
  }, [logs, userFilter]);

  const totalPages = Math.ceil(filteredLogs.length / perPage);
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * perPage, currentPage * perPage);

  const getActionColor = (action: string) => {
    if (action.includes("Login")) return "bg-indigo-100 text-indigo-700";
    if (action.includes("Create") || action.includes("Created")) return "bg-emerald-100 text-emerald-700";
    if (action.includes("Delete") || action.includes("Remove")) return "bg-red-100 text-red-700";
    if (action.includes("Stop") || action.includes("Deactiv")) return "bg-rose-100 text-rose-700";
    if (action.includes("Start") || action.includes("Bind") || action.includes("Bound") || action.includes("Activ")) return "bg-emerald-100 text-emerald-700";
    if (action.includes("Update") || action.includes("Edit")) return "bg-amber-100 text-amber-700";
    if (action.includes("Reset")) return "bg-red-100 text-red-700";
    if (action.includes("Export")) return "bg-teal-100 text-teal-700";
    return "bg-gray-100 text-gray-600";
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Audit Logs
        </h1>
        <p className="text-sm text-gray-500 mt-1">Complete trail of all user actions and system events</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
                <input
                  type="text"
                  placeholder="Search logs..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="pl-9 pr-4 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                />
              </div>
              <select
                value={actionFilter}
                onChange={(e) => { setActionFilter(e.target.value); setCurrentPage(1); }}
                className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="all">All Actions</option>
                {uniqueActions.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <select
                value={userFilter}
                onChange={(e) => { setUserFilter(e.target.value); setCurrentPage(1); }}
                className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="all">All Users</option>
                {uniqueUsers.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-400">{filteredLogs.length} entries</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Timestamp</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">User</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Action</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Entity</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Details</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">IP Address</th>
              </tr>
            </thead>
            <tbody>
              {paginatedLogs.map((log) => (
                <tr key={log.id} className="border-b border-gray-50 hover:bg-[#f9faf7] transition-colors">
                  <td className="px-5 py-3">
                    <p className="text-xs font-mono text-gray-500 whitespace-nowrap">{formatTime(log.createdAt)}</p>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-semibold text-emerald-700">{log.userName.split(" ").map((n) => n[0]).join("").slice(0, 2)}</span>
                      </div>
                      <span className="text-sm text-gray-900 whitespace-nowrap">{log.userName}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getActionColor(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-gray-500">{log.entityType}</span>
                    <span className="text-xs text-gray-300 ml-1">{log.entityId}</span>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-xs text-gray-600 max-w-64 truncate">{log.details}</p>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-xs font-mono text-gray-400">{log.ipAddress}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredLogs.length === 0 && (
          <div className="py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-gray-100 mx-auto mb-3">
              <i className="ri-file-list-3-line text-gray-300 text-xl"></i>
            </div>
            <p className="text-sm text-gray-400">No audit logs match your filters</p>
          </div>
        )}

        {totalPages > 1 && (
          <div className="p-4 border-t border-gray-200 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              Showing {(currentPage - 1) * perPage + 1}-{Math.min(currentPage * perPage, filteredLogs.length)} of {filteredLogs.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <i className="ri-arrow-left-s-line text-gray-500"></i>
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setCurrentPage(p)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                    currentPage === p ? "bg-emerald-600 text-white" : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <i className="ri-arrow-right-s-line text-gray-500"></i>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}