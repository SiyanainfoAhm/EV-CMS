import { useState, useMemo, useEffect } from "react";
import * as supportTicketService from "@/services/supportTicketService";
import * as userService from "@/services/userService";
import type { SupportTicket, User } from "@/types/ev";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { canAccessWebAdmin } from "@/utils/rfpRoles";

const STATUS_OPTIONS = ["open", "in_progress", "resolved", "closed"] as const;
const PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"] as const;

function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "open":
      return "bg-amber-100 text-amber-700";
    case "in_progress":
      return "bg-blue-100 text-blue-700";
    case "resolved":
      return "bg-emerald-100 text-emerald-700";
    case "closed":
      return "bg-gray-100 text-gray-600";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

function priorityBadgeClass(priority: string): string {
  switch (priority) {
    case "urgent":
      return "bg-red-100 text-red-700";
    case "high":
      return "bg-orange-100 text-orange-700";
    case "low":
      return "bg-gray-100 text-gray-600";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function labelize(value: string): string {
  return value.replace(/_/g, " ");
}

export default function SupportTicketsPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [admins, setAdmins] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const [editAssignee, setEditAssignee] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadTickets = () =>
    supportTicketService
      .getSupportTickets({ status: statusFilter, priority: priorityFilter, search: debouncedSearch })
      .then(setTickets)
      .catch((e) => showToast(e instanceof Error ? e.message : "Failed to load tickets"));

  useEffect(() => {
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, priorityFilter, debouncedSearch]);

  useEffect(() => {
    userService
      .getUsers({ status: "active" })
      .then((users) => setAdmins(users.filter((u) => canAccessWebAdmin(u.role))))
      .catch(console.error);
  }, []);

  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedId) ?? null,
    [tickets, selectedId]
  );

  const stats = useMemo(() => {
    return {
      total: tickets.length,
      open: tickets.filter((t) => t.status === "open").length,
      inProgress: tickets.filter((t) => t.status === "in_progress").length,
      resolved: tickets.filter((t) => t.status === "resolved" || t.status === "closed").length,
    };
  }, [tickets]);

  const openDetail = (ticket: SupportTicket) => {
    setSelectedId(ticket.id);
    setEditStatus(ticket.status);
    setEditPriority(ticket.priority);
    setEditAssignee(ticket.assignedTo ?? "");
  };

  const closeDetail = () => {
    setSelectedId(null);
  };

  const saveTicket = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await supportTicketService.updateSupportTicket(selectedId, {
        status: editStatus,
        priority: editPriority,
        assignedTo: editAssignee || null,
      });
      await loadTickets();
      showToast("Ticket updated");
      closeDetail();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update ticket");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 min-w-0 max-w-full">
      {toast && (
        <div className="fixed top-20 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Support Tickets
        </h1>
        <p className="text-sm text-gray-500 mt-1">Review and manage help requests from mobile users</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-0">
          <p className="text-xs text-gray-500 mb-1 truncate">Total</p>
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-0">
          <p className="text-xs text-gray-500 mb-1 truncate">Open</p>
          <p className="text-2xl font-bold text-amber-600">{stats.open}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-0">
          <p className="text-xs text-gray-500 mb-1 truncate">In Progress</p>
          <p className="text-2xl font-bold text-blue-600">{stats.inProgress}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-0">
          <p className="text-xs text-gray-500 mb-1 truncate">Resolved / Closed</p>
          <p className="text-2xl font-bold text-emerald-600">{stats.resolved}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 min-w-0 max-w-full overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-none min-w-0">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
                <input
                  type="text"
                  placeholder="Search subject, user, or message..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full sm:w-64 pl-9 pr-4 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="all">All Status</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {labelize(s)}
                  </option>
                ))}
              </select>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="all">All Priority</option>
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {labelize(p)}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-400 shrink-0">{tickets.length} tickets</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] table-fixed">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[22%]">
                  Subject
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[16%]">
                  User
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[10%]">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[10%]">
                  Priority
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[14%]">
                  Assigned
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[14%]">
                  Created
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[8%]">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="border-b border-gray-50 hover:bg-[#f9faf7] transition-colors">
                  <td className="px-4 py-3.5 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate" title={ticket.subject}>
                      {ticket.subject}
                    </p>
                    <p className="text-xs text-gray-400 truncate" title={ticket.description}>
                      {ticket.description}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 min-w-0">
                    <p className="text-sm text-gray-900 truncate">{ticket.userName || "—"}</p>
                    <p className="text-xs text-gray-400 truncate">{ticket.userEmail}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${statusBadgeClass(ticket.status)}`}
                    >
                      {labelize(ticket.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${priorityBadgeClass(ticket.priority)}`}
                    >
                      {labelize(ticket.priority)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 min-w-0">
                    <p className="text-sm text-gray-600 truncate">{ticket.assignedToName ?? "Unassigned"}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="text-sm text-gray-500 whitespace-nowrap">{formatTime(ticket.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => openDetail(ticket)}
                      className="text-xs font-medium text-emerald-600 hover:text-emerald-700 whitespace-nowrap"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {tickets.length === 0 && (
          <div className="py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-gray-100 mx-auto mb-3">
              <i className="ri-customer-service-2-line text-gray-300 text-xl"></i>
            </div>
            <p className="text-sm text-gray-400">No support tickets found</p>
          </div>
        )}
      </div>

      {selectedTicket && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closeDetail}></div>
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-100 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-gray-900">{selectedTicket.subject}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedTicket.userName} · {selectedTicket.userEmail}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeDetail}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"
                >
                  <i className="ri-close-line text-lg"></i>
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Description</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedTicket.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Status</label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="w-full px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {labelize(s)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Priority</label>
                    <select
                      value={editPriority}
                      onChange={(e) => setEditPriority(e.target.value)}
                      className="w-full px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {labelize(p)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Assigned to</label>
                  <select
                    value={editAssignee}
                    onChange={(e) => setEditAssignee(e.target.value)}
                    className="w-full px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    <option value="">Unassigned</option>
                    {admins.map((admin) => (
                      <option key={admin.id} value={admin.id}>
                        {admin.name} ({admin.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="text-xs text-gray-400 space-y-1 pt-2 border-t border-gray-100">
                  <p>Created: {formatTime(selectedTicket.createdAt)}</p>
                  <p>Updated: {formatTime(selectedTicket.updatedAt)}</p>
                </div>
              </div>

              <div className="p-6 border-t border-gray-100 flex items-center gap-3">
                <button
                  type="button"
                  onClick={closeDetail}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveTicket}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
