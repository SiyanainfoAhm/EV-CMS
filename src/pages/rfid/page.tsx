import { useState, useEffect, useMemo } from "react";
import * as rfidService from "@/services/rfidService";
import * as userService from "@/services/userService";
import type { RFIDCard, User } from "@/types/ev";
import { FormField, inputClassName } from "@/components/ui/FormField";
import { validateRfidUid, validateRequired } from "@/utils/validation";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

function formatTime(isoStr: string | null): string {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RfidPage() {
  const [cards, setCards] = useState<RFIDCard[]>([]);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [bindTarget, setBindTarget] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [newCardUid, setNewCardUid] = useState("");
  const [uidError, setUidError] = useState<string | undefined>();
  const [bindError, setBindError] = useState<string | undefined>();
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  const loadCards = () =>
    rfidService
      .getRfidCards({ status: statusFilter, search: debouncedSearch })
      .then(setCards)
      .catch((e) => showToast(e instanceof Error ? e.message : "Failed to load RFID cards"));

  const loadUsers = () => userService.getUsers().then(setUsersList).catch(console.error);

  useEffect(() => {
    loadCards();
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, debouncedSearch]);

  const filteredCards = useMemo(() => cards, [cards]);

  const handleAdd = async () => {
    const err = validateRfidUid(newCardUid);
    setUidError(err ?? undefined);
    if (err) return;
    try {
      await rfidService.createRfidCard(newCardUid.trim());
      await loadCards();
      setShowAddModal(false);
      setNewCardUid("");
      showToast("RFID card added successfully");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to add card. Run supabase/policies_write.sql");
    }
  };

  const toggleStatus = async (cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    const newStatus = card.status === "active" ? "inactive" : card.status === "inactive" ? "active" : "active";
    try {
      await rfidService.updateRfidStatus(cardId, newStatus);
      await loadCards();
      showToast("Card status updated");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update card");
    }
  };

  const handleBind = async () => {
    if (!bindTarget) return;
    const err = validateRequired(selectedUser, "User");
    setBindError(err ?? undefined);
    if (err) return;
    try {
      await rfidService.bindRfidToUser(bindTarget, selectedUser);
      await loadCards();
      setBindTarget(null);
      setSelectedUser("");
      showToast("RFID card bound to user");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to bind card");
    }
  };

  const unbind = async (cardId: string) => {
    try {
      await rfidService.unbindRfid(cardId);
      await loadCards();
      showToast("RFID card unbound");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to unbind card");
    }
  };

  const activeCards = cards.filter((c) => c.status === "active" && c.boundUser).length;
  const unassigned = cards.filter((c) => c.status === "active" && !c.boundUser).length;
  const blocked = cards.filter((c) => c.status === "blocked").length;

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed top-20 right-6 z-50 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm shadow-lg animate-pulse">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            RFID Card Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage RFID cards for charger authentication</p>
        </div>
        <button
          onClick={() => { setNewCardUid(""); setUidError(undefined); setShowAddModal(true); }}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap flex items-center gap-2"
        >
          <div className="w-4 h-4 flex items-center justify-center">
            <i className="ri-add-line"></i>
          </div>
          Add RFID Card
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Active &amp; Bound</p>
          <p className="text-2xl font-bold text-emerald-600">{activeCards}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Unassigned</p>
          <p className="text-2xl font-bold text-amber-600">{unassigned}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Blocked</p>
          <p className="text-2xl font-bold text-red-500">{blocked}</p>
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
                  placeholder="Search by UID or user..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
            <p className="text-xs text-gray-400">{filteredCards.length} cards</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">RFID UID</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Bound User</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Created</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Last Used</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Sessions</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCards.map((card) => (
                <tr key={card.id} className="border-b border-gray-50 hover:bg-[#f9faf7] transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100">
                        <i className="ri-sim-card-line text-gray-500"></i>
                      </div>
                      <span className="text-sm font-mono font-medium text-gray-900">{card.uid}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={() => toggleStatus(card.id)}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                        card.status === "active"
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                          : card.status === "blocked"
                          ? "bg-red-100 text-red-700 hover:bg-red-200"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {card.status}
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    {card.boundUser ? (
                      <div>
                        <p className="text-sm font-medium text-gray-900">{card.boundUser}</p>
                        <button
                          onClick={() => unbind(card.id)}
                          className="text-xs text-red-500 hover:text-red-600 mt-0.5"
                        >
                          Unbind
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setBindTarget(card.id); setSelectedUser(""); }}
                        className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                      >
                        Bind to user
                      </button>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm text-gray-500">{card.createdAt}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm text-gray-500">{formatTime(card.lastUsed)}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-semibold text-gray-900">{card.totalSessions}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1">
                      {card.status !== "blocked" && (
                        <button
                          onClick={() => toggleStatus(card.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors"
                          title="Block card"
                        >
                          <i className="ri-forbid-2-line text-gray-400 hover:text-red-500"></i>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowAddModal(false)}></div>
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Add RFID Card</h3>
              <FormField label="RFID UID" error={uidError} required>
                <input
                  type="text"
                  value={newCardUid}
                  onChange={(e) => {
                    setNewCardUid(e.target.value);
                    if (uidError) setUidError(undefined);
                  }}
                  className={`${inputClassName(!!uidError)} font-mono`}
                  placeholder="e.g. RFID-DFCCIL-009"
                />
              </FormField>
              <div className="flex items-center gap-3 mt-6">
                <button onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap">Cancel</button>
                <button onClick={handleAdd} className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap">Add Card</button>
              </div>
            </div>
          </div>
        </>
      )}

      {bindTarget && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setBindTarget(null)}></div>
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Bind RFID to User</h3>
              <p className="text-xs text-gray-500 mb-4">
                Each RFID can be assigned to only one user. If the user already has a card, it will be replaced.
              </p>
              <FormField label="Select User" error={bindError} required>
                <select
                  value={selectedUser}
                  onChange={(e) => {
                    setSelectedUser(e.target.value);
                    if (bindError) setBindError(undefined);
                  }}
                  className={inputClassName(!!bindError)}
                >
                  <option value="">Choose a user...</option>
                  {usersList.filter((u) => u.status === "active").map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.department}){u.rfidBound ? ` — current: ${u.rfidBound}` : ""}
                    </option>
                  ))}
                </select>
              </FormField>
              <div className="flex items-center gap-3 mt-6">
                <button onClick={() => setBindTarget(null)} className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap">Cancel</button>
                <button onClick={handleBind} className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap">Bind</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}