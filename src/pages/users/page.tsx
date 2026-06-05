import { useState, useEffect, useMemo } from "react";
import * as userService from "@/services/userService";
import type { User } from "@/types/ev";
import { FormField, inputClassName } from "@/components/ui/FormField";
import { hasErrors, validateUserForm } from "@/utils/validation";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

interface UserFormData {
  name: string;
  email: string;
  role: string;
  department: string;
}

const emptyForm: UserFormData = { name: "", email: "", role: "User", department: "Operations" };

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [formData, setFormData] = useState<UserFormData>(emptyForm);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof UserFormData, string>>>({});
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

  const handleAdd = async () => {
    const errors = validateUserForm(formData);
    setFormErrors(errors);
    if (hasErrors(errors)) return;
    try {
      await userService.createUser(formData);
      await loadUsers();
      setShowAddModal(false);
      setFormData(emptyForm);
      showToast("User added successfully");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to add user. Run supabase/policies_write.sql");
    }
  };

  const handleEdit = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    setFormData({
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department ?? "Operations",
    });
    setFormErrors({});
    setEditingUser(userId);
  };

  const saveEdit = async () => {
    if (!editingUser) return;
    const errors = validateUserForm(formData);
    setFormErrors(errors);
    if (hasErrors(errors)) return;
    try {
      await userService.updateUser(editingUser, formData);
      await loadUsers();
      setEditingUser(null);
      setFormData(emptyForm);
      showToast("User updated successfully");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update user");
    }
  };

  const toggleStatus = async (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    const next = user.status === "active" ? "inactive" : "active";
    try {
      await userService.setUserStatus(userId, next);
      await loadUsers();
      showToast("User status updated");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update status");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await userService.deleteUser(deleteTarget);
      await loadUsers();
      setDeleteTarget(null);
      showToast("User removed");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to remove user");
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
          onClick={() => { setFormData(emptyForm); setFormErrors({}); setShowAddModal(true); }}
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
                        onClick={() => handleEdit(user.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <i className="ri-edit-line text-gray-400"></i>
                      </button>
                      <button
                        onClick={() => setDeleteTarget(user.id)}
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

      {(showAddModal || editingUser) && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => { setShowAddModal(false); setEditingUser(null); }}></div>
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {editingUser ? "Edit User" : "Add New User"}
              </h3>
              <div className="space-y-4">
                <FormField label="Full Name" error={formErrors.name} required>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className={inputClassName(!!formErrors.name)}
                    placeholder="Enter full name"
                  />
                </FormField>
                <FormField label="Email" error={formErrors.email} required>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className={inputClassName(!!formErrors.email)}
                    placeholder="name@dfccil.gov.in"
                  />
                </FormField>
                <FormField label="Role" error={formErrors.role} required>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className={inputClassName(!!formErrors.role)}
                  >
                    <option value="User">User (mobile app)</option>
                    <option value="SiteAdmin">Site Admin</option>
                    <option value="SuperAdmin">Super Admin</option>
                  </select>
                </FormField>
                <FormField label="Department" error={formErrors.department} required>
                  <select
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className={inputClassName(!!formErrors.department)}
                  >
                    <option value="Operations">Operations</option>
                    <option value="Logistics">Logistics</option>
                    <option value="IT">IT</option>
                    <option value="Management">Management</option>
                  </select>
                </FormField>
              </div>
              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={() => { setShowAddModal(false); setEditingUser(null); }}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  onClick={editingUser ? saveEdit : handleAdd}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap"
                >
                  {editingUser ? "Save Changes" : "Add User"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {deleteTarget && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setDeleteTarget(null)}></div>
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-red-100">
                  <i className="ri-delete-bin-line text-red-600 text-lg"></i>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">Delete User</h4>
                  <p className="text-xs text-gray-500">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Are you sure you want to remove this user? All associated sessions and records will be retained.
              </p>
              <div className="flex items-center gap-3">
                <button onClick={() => setDeleteTarget(null)} className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap">Cancel</button>
                <button onClick={confirmDelete} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors whitespace-nowrap">Delete</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}