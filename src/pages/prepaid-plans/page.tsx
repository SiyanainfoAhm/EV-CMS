import { useEffect, useState } from "react";
import * as prepaidPlanService from "@/services/prepaidPlanService";
import * as auditLogService from "@/services/auditLogService";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { useAuth } from "@/hooks/useAuth";
import type { PrepaidMode, PrepaidPlan } from "@/types/ev";
import { FormField, inputClassName } from "@/components/ui/FormField";

interface PlanForm {
  mode: PrepaidMode;
  value: number;
  label: string;
  sortOrder: number;
}

const emptyForm: PlanForm = { mode: "amount", value: 100, label: "₹100", sortOrder: 100 };

function defaultLabel(mode: PrepaidMode, value: number): string {
  if (mode === "amount") return `₹${value}`;
  if (value >= 60 && value % 60 === 0) return `${value / 60} hour${value === 60 ? "" : "s"}`;
  return `${value} min`;
}

export default function PrepaidPlansPage() {
  const { formatCurrency } = useUserPreferences();
  const { user } = useAuth();
  const [plans, setPlans] = useState<PrepaidPlan[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = () =>
    prepaidPlanService
      .getPrepaidPlans()
      .then(setPlans)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load prepaid plans"));

  useEffect(() => {
    load();
  }, []);

  const openAdd = () => {
    setEditId(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (plan: PrepaidPlan) => {
    setEditId(plan.id);
    setForm({
      mode: plan.mode,
      value: plan.value,
      label: plan.label,
      sortOrder: plan.sortOrder,
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.label.trim() || form.value <= 0) {
      showToast("Label and value are required");
      return;
    }
    try {
      const label = form.label.trim() || defaultLabel(form.mode, form.value);
      if (editId) {
        await prepaidPlanService.updatePrepaidPlan(editId, {
          ...form,
          label,
          isActive: true,
        });
        if (user?.id) {
          void auditLogService.logPrepaidPlanUpdated({
            userId: user.id,
            planId: editId,
            label,
            mode: form.mode,
            value: form.value,
          });
        }
        showToast("Prepaid plan updated");
      } else {
        const created = await prepaidPlanService.createPrepaidPlan({
          ...form,
          label,
          isActive: true,
        });
        if (user?.id) {
          void auditLogService.logPrepaidPlanCreated({
            userId: user.id,
            planId: created.id,
            label: created.label,
            mode: created.mode,
            value: created.value,
          });
        }
        showToast("Prepaid plan added");
      }
      setShowModal(false);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed — run supabase/prepaid_billing.sql");
    }
  };

  const toggle = async (plan: PrepaidPlan) => {
    try {
      const nextActive = !plan.isActive;
      await prepaidPlanService.togglePrepaidPlanActive(plan.id, nextActive);
      if (user?.id) {
        void auditLogService.logPrepaidPlanToggled({
          userId: user.id,
          planId: plan.id,
          label: plan.label,
          isActive: nextActive,
        });
      }
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Toggle failed");
    }
  };

  const amountPlans = plans.filter((p) => p.mode === "amount");
  const timePlans = plans.filter((p) => p.mode === "time");

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed top-20 right-6 z-50 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Prepaid Plans
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Pay-before-charge presets only (amount or time). No postpaid / pay-later option.
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap flex items-center gap-2"
        >
          <i className="ri-add-line"></i>
          Add Plan
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm">
          {error}
          <p className="text-xs mt-1">Apply <code className="font-mono">supabase/prepaid_billing.sql</code> if the table is missing.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PlanGroup
          title="By Amount"
          subtitle="User pays this amount (GST applied at checkout)"
          plans={amountPlans}
          formatValue={(p) => formatCurrency(p.value)}
          onEdit={openEdit}
          onToggle={toggle}
        />
        <PlanGroup
          title="By Time"
          subtitle="User prepays estimated cost for this duration"
          plans={timePlans}
          formatValue={(p) => prepaidPlanService.formatPrepaidPlanValue(p)}
          onEdit={openEdit}
          onToggle={toggle}
        />
      </div>

      {showModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowModal(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {editId ? "Edit Prepaid Plan" : "Add Prepaid Plan"}
              </h3>
              <div className="space-y-4">
                <FormField label="Mode" required>
                  <select
                    value={form.mode}
                    onChange={(e) => {
                      const mode = e.target.value as PrepaidMode;
                      setForm((prev) => ({
                        ...prev,
                        mode,
                        label: defaultLabel(mode, prev.value),
                      }));
                    }}
                    className={inputClassName(false)}
                  >
                    <option value="amount">Amount (₹)</option>
                    <option value="time">Time (minutes)</option>
                  </select>
                </FormField>
                <FormField label={form.mode === "amount" ? "Amount (₹)" : "Duration (minutes)"} required>
                  <input
                    type="number"
                    min={1}
                    step={form.mode === "amount" ? 1 : 1}
                    value={form.value}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value) || 0;
                      setForm((prev) => ({
                        ...prev,
                        value,
                        label: defaultLabel(prev.mode, value),
                      }));
                    }}
                    className={inputClassName(false)}
                  />
                </FormField>
                <FormField label="Label" required>
                  <input
                    type="text"
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    className={inputClassName(false)}
                    placeholder="e.g. ₹100 or 15 min"
                  />
                </FormField>
                <FormField label="Sort order">
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value, 10) || 0 })}
                    className={inputClassName(false)}
                  />
                </FormField>
              </div>
              <div className="flex items-center gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
                >
                  {editId ? "Save" : "Add"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PlanGroup({
  title,
  subtitle,
  plans,
  formatValue,
  onEdit,
  onToggle,
}: {
  title: string;
  subtitle: string;
  plans: PrepaidPlan[];
  formatValue: (p: PrepaidPlan) => string;
  onEdit: (p: PrepaidPlan) => void;
  onToggle: (p: PrepaidPlan) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <p className="text-xs text-gray-500 mt-0.5 mb-4">{subtitle}</p>
      {plans.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No plans yet</p>
      ) : (
        <ul className="space-y-2">
          {plans.map((plan) => (
            <li
              key={plan.id}
              className={`flex items-center gap-3 p-3 rounded-lg border ${
                plan.isActive ? "border-gray-200" : "border-gray-100 bg-gray-50 opacity-70"
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{plan.label}</p>
                <p className="text-xs text-gray-500">
                  {formatValue(plan)} · sort {plan.sortOrder}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onToggle(plan)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  plan.isActive ? "bg-emerald-500" : "bg-gray-300"
                }`}
                title={plan.isActive ? "Active" : "Inactive"}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    plan.isActive ? "left-5" : "left-0.5"
                  }`}
                />
              </button>
              <button
                type="button"
                onClick={() => onEdit(plan)}
                className="px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-100"
              >
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
