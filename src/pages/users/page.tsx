import { useState, useEffect, useMemo } from "react";
import * as userService from "@/services/userService";
import type { User } from "@/types/ev";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  sendAccountActivatedEmail,
  sendEmailInBackground,
} from "@/services/powerAutomateEmailService";
import {
  UserDeleteModal,
  UserFormModal,
  emptyUserForm,
  userToForm,
  USER_DEPARTMENTS,
  USER_ROLE_OPTIONS,
  USER_STATUS_OPTIONS,
  type UserSavedDetail,
} from "@/components/users";

type UserModalMode = "add" | "edit" | null;

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [modalMode, setModalMode] = useState<UserModalMode>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formInitial, setFormInitial] = useState(emptyUserForm);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  const loadUsers = () =>
    userService
      .getUsers({ role: roleFilter, status: statusFilter, search: debouncedSearch })
      .then(setUsers)
      .catch((e) => showToast(e instanceof Error ? e.message : "Failed to load users"));

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFilter, statusFilter, debouncedSearch]);

  const filteredUsers = useMemo(() => users, [users]);

  const openAddModal = () => {
    setEditingUser(null);
    setFormInitial(emptyUserForm);
    setModalMode("add");
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormInitial(userToForm(user));
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingUser(null);
    setFormInitial(emptyUserForm);
  };

  const handleSaved = (detail: UserSavedDetail) => {
    void loadUsers();
    if (detail.mode === "edit") {
      if (detail.activationEmailSent && detail.email) {
        showToast(`User updated. Activation email sent to ${detail.email}`);
      } else {
        showToast("User updated successfully");
      }
      return;
    }
    if (detail.welcomeEmailSent && detail.email) {
      showToast(`User added. Welcome email sent to ${detail.email}`);
      return;
    }
    if (detail.welcomeEmailWarning) {
      showToast(`User added. ${detail.welcomeEmailWarning}`);
      return;
    }
    showToast("User added successfully");
  };

  const toggleStatus = async (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    const next = user.status === "active" ? "inactive" : "active";
    try {
      await userService.setUserStatus(userId, next);
      await loadUsers();
      if (next === "active") {
        sendEmailInBackground(
          sendAccountActivatedEmail({
            name: user.name,
            email: user.email,
            role: user.role,
          })
        );
        showToast(`User activated. Notification email sent to ${user.email}`);
      } else {
        showToast("User status updated");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update status");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await userService.deleteUser(deleteTarget.id);
      await loadUsers();
      setDeleteTarget(null);
      showToast("User removed");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to remove user");
    } finally {
      setDeleteLoading(false);
    }
  };

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
            User Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage DFCCIL accounts — RFP roles: User (mobile), Site Admin, Super Admin</p>
        </div>
        <button
          onClick={openAddModal}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap flex items-center gap-2"
        >
          <div className="w-4 h-4 flex items-center justify-center">
            <i className="ri-add-line"></i>
          </div>
          Add User
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
                <input
                  type="text"
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                />
              </div>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="all">All Roles</option>
                <option value="User">User</option>
                <option value="SiteAdmin">Site Admin</option>
                <option value="SuperAdmin">Super Admin</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <p className="text-xs text-gray-400">{filteredUsers.length} users</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">User</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Role</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Department</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">RFID</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Joined</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Last Login</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="border-b border-gray-50 hover:bg-[#f9faf7] transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-emerald-700">{user.name.split(" ").map((n) => n[0]).join("")}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{user.name}</p>
                        <p className="text-xs text-gray-400">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      user.role === "SuperAdmin" ? "bg-rose-100 text-rose-700" : user.role === "SiteAdmin" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm text-gray-600">{user.department}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm text-gray-600">{user.rfidBound || <span className="text-gray-300">—</span>}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={() => toggleStatus(user.id)}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                        user.status === "active" ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                      }`}
                    >
                      {user.status}
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm text-gray-500">{user.joinedDate}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-xs text-gray-500">{user.lastLogin || "—"}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEditModal(user)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <i className="ri-edit-line text-gray-400"></i>
                      </button>
                      <button
                        onClick={() => setDeleteTarget(user)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors"
                      >
                        <i className="ri-delete-bin-line text-gray-400 hover:text-red-500"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <UserFormModal
        open={modalMode !== null}
        mode={modalMode === "edit" ? "edit" : "add"}
        editingId={editingUser?.id}
        initialForm={formInitial}
        boundRfid={editingUser?.rfidBound}
        previousStatus={editingUser?.status === "inactive" ? "inactive" : "active"}
        onClose={closeModal}
        onSaved={handleSaved}
        onError={(msg) => showToast(msg)}
      />

      <UserDeleteModal
        open={deleteTarget !== null}
        userName={deleteTarget?.name}
        deleting={deleteLoading}
        onClose={() => !deleteLoading && setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
