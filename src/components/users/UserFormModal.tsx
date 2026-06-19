import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FormField, inputClassName } from "@/components/ui/FormField";
import * as userService from "@/services/userService";
import type { User } from "@/types/ev";
import { hasErrors, validateUserForm, type UserFormFields } from "@/utils/validation";
import { sendWelcomeEmail, sendAccountActivatedEmail } from "@/services/powerAutomateEmailService";

export interface UserSavedDetail {
  mode: "add" | "edit";
  email?: string;
  welcomeEmailSent?: boolean;
  welcomeEmailWarning?: string;
  activationEmailSent?: boolean;
}

export const USER_DEPARTMENTS = ["Operations", "Logistics", "IT", "Management"] as const;

export const USER_ROLE_OPTIONS = [
  { value: "User", label: "User (mobile app)" },
  { value: "SiteAdmin", label: "Site Admin" },
  { value: "SuperAdmin", label: "Super Admin" },
] as const;

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export const USER_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

export const emptyUserForm: UserFormFields = {
  name: "",
  email: "",
  role: "User",
  department: "Operations",
  joinedDate: todayIsoDate(),
  status: "active",
};

export function userToForm(user: User): UserFormFields {
  return {
    name: user.name,
    email: user.email,
    role: user.role === "SuperAdmin" || user.role === "SiteAdmin" ? user.role : "User",
    department: user.department ?? "Operations",
    joinedDate: user.joinedDate ?? todayIsoDate(),
    status: user.status === "inactive" ? "inactive" : "active",
  };
}

interface UserFormModalProps {
  open: boolean;
  mode: "add" | "edit";
  editingId?: string;
  initialForm?: UserFormFields;
  boundRfid?: string | null;
  previousStatus?: "active" | "inactive";
  onClose: () => void;
  onSaved: (detail: UserSavedDetail) => void;
  onError: (message: string) => void;
}

export function UserFormModal({
  open,
  mode,
  editingId,
  initialForm = emptyUserForm,
  boundRfid,
  previousStatus,
  onClose,
  onSaved,
  onError,
}: UserFormModalProps) {
  const [formData, setFormData] = useState<UserFormFields>(initialForm);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof UserFormFields, string>>>({});
  const [saving, setSaving] = useState(false);
  const [sendWelcomeEmailOnCreate, setSendWelcomeEmailOnCreate] = useState(true);

  useEffect(() => {
    if (open) {
      setFormData(initialForm);
      setFormErrors({});
      if (mode === "add") setSendWelcomeEmailOnCreate(true);
    }
  }, [open, initialForm, mode]);

  if (!open) return null;

  const isEdit = mode === "edit";

  const handleSubmit = async () => {
    const errors = validateUserForm(formData);
    setFormErrors(errors);
    if (hasErrors(errors)) return;

    setSaving(true);
    try {
      if (isEdit && editingId) {
        await userService.updateUser(editingId, formData);

        let activationEmailSent = false;
        if (previousStatus === "inactive" && formData.status === "active") {
          const emailResult = await sendAccountActivatedEmail({
            name: formData.name,
            email: formData.email,
            role: formData.role,
          });
          activationEmailSent = emailResult.success;
        }

        onSaved({ mode: "edit", email: formData.email.trim(), activationEmailSent });
      } else {
        await userService.createUser(formData);

        let welcomeEmailSent = false;
        let welcomeEmailWarning: string | undefined;

        if (sendWelcomeEmailOnCreate) {
          const emailResult = await sendWelcomeEmail({
            name: formData.name,
            email: formData.email,
            role: formData.role,
            department: formData.department,
            joinedDate: formData.joinedDate,
            status: formData.status,
          });
          if (emailResult.success) {
            welcomeEmailSent = true;
          } else {
            welcomeEmailWarning = emailResult.error ?? "Welcome email could not be sent.";
          }
        }

        onSaved({
          mode: "add",
          email: formData.email.trim(),
          welcomeEmailSent,
          welcomeEmailWarning,
        });
      }
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      onError(
        message.includes("p_joined_date") || message.includes("create_ev_user")
          ? "Joining date not supported yet — run supabase/users_joined_date.sql on Supabase."
          : message ||
            (isEdit ? "Failed to update user" : "Failed to add user. Run supabase/policies_write.sql")
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !saving && onClose()} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            {isEdit ? "Edit User" : "Add New User"}
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            {isEdit
              ? "Update account details. Default password is unchanged unless reset separately."
              : "Creates a DFCCIL account with default login password (dfccil123) until changed."}
          </p>
          <div className="space-y-4">
            <FormField label="Full Name" error={formErrors.name} required>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={inputClassName(!!formErrors.name)}
                placeholder="Enter full name"
                disabled={saving}
              />
            </FormField>
            <FormField label="Email" error={formErrors.email} required>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={inputClassName(!!formErrors.email)}
                placeholder="you@example.com"
                disabled={saving}
              />
            </FormField>
            <FormField label="Role" error={formErrors.role} required>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className={inputClassName(!!formErrors.role)}
                disabled={saving}
              >
                {USER_ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Department" error={formErrors.department} required>
              <select
                value={formData.department}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                className={inputClassName(!!formErrors.department)}
                disabled={saving}
              >
                {USER_DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Joining Date" error={formErrors.joinedDate} required>
              <input
                type="date"
                value={formData.joinedDate}
                onChange={(e) => setFormData({ ...formData, joinedDate: e.target.value })}
                className={inputClassName(!!formErrors.joinedDate)}
                disabled={saving}
              />
            </FormField>
            <FormField label="Status" error={formErrors.status} required>
              <select
                value={formData.status}
                onChange={(e) =>
                  setFormData({ ...formData, status: e.target.value as "active" | "inactive" })
                }
                className={inputClassName(!!formErrors.status)}
                disabled={saving}
              >
                {USER_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </FormField>
            {isEdit ? (
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                <p className="text-xs text-gray-400 mb-1">RFID card</p>
                <p className="text-sm font-mono text-gray-800">
                  {boundRfid || <span className="text-gray-400 font-sans">Not assigned</span>}
                </p>
                <p className="text-[11px] text-gray-500 mt-2">
                  Assign or change RFID on the{" "}
                  <Link to="/rfid" className="text-emerald-600 hover:text-emerald-700 font-medium" onClick={onClose}>
                    RFID Cards
                  </Link>{" "}
                  page. One user can have only one RFID; one RFID cannot be shared across users.
                </p>
              </div>
            ) : (
              <label className="flex items-start gap-3 p-3 bg-emerald-50/60 rounded-lg border border-emerald-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendWelcomeEmailOnCreate}
                  onChange={(e) => setSendWelcomeEmailOnCreate(e.target.checked)}
                  disabled={saving}
                  className="mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>
                  <span className="text-sm font-medium text-gray-900 block">Send welcome email</span>
                  <span className="text-[11px] text-gray-500">
                    Notifies the user that their EV-CMS account was created (via Power Automate).
                  </span>
                </span>
              </label>
            )}
          </div>
          <div className="flex items-center gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving}
              className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Add User"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
