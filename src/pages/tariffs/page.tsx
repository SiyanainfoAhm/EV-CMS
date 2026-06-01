import { useState, useEffect } from "react";
import * as tariffService from "@/services/tariffService";
import type { Tariff } from "@/types/ev";
import { FormField, inputClassName } from "@/components/ui/FormField";
import { hasErrors, validateTariffForm } from "@/utils/validation";

interface TariffFormData {
  name: string;
  ratePerKwh: number;
  sessionFee: number;
  gstPercent: number;
  appliesTo: string;
}

const emptyTariff: TariffFormData = { name: "", ratePerKwh: 0, sessionFee: 0, gstPercent: 18, appliesTo: "DC Fast" };

export default function TariffsPage() {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [formData, setFormData] = useState<TariffFormData>(emptyTariff);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof TariffFormData, string>>>({});
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadTariffs = () =>
    tariffService.getTariffs().then(setTariffs).catch((e) => showToast(e instanceof Error ? e.message : "Failed to load tariffs"));

  useEffect(() => {
    loadTariffs();
  }, []);

  const handleAdd = async () => {
    const errors = validateTariffForm(formData);
    setFormErrors(errors);
    if (hasErrors(errors)) return;
    try {
      await tariffService.createTariff({ ...formData, isActive: true });
      await loadTariffs();
      setShowAddModal(false);
      setFormData(emptyTariff);
      showToast("Tariff added successfully");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to add tariff. Run supabase/policies_write.sql");
    }
  };

  const handleEdit = (id: string) => {
    const t = tariffs.find((t) => t.id === id);
    if (!t) return;
    setFormData({ name: t.name, ratePerKwh: t.ratePerKwh, sessionFee: t.sessionFee, gstPercent: t.gstPercent, appliesTo: t.appliesTo });
    setFormErrors({});
    setEditTarget(id);
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    const errors = validateTariffForm(formData);
    setFormErrors(errors);
    if (hasErrors(errors)) return;
    try {
      await tariffService.updateTariff(editTarget, formData);
      await loadTariffs();
      setEditTarget(null);
      setFormData(emptyTariff);
      showToast("Tariff updated");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update tariff");
    }
  };

  const toggleActive = async (id: string) => {
    const t = tariffs.find((x) => x.id === id);
    if (!t) return;
    try {
      await tariffService.toggleTariffActive(id, !t.isActive);
      await loadTariffs();
      showToast("Tariff status toggled");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to toggle tariff");
    }
  };

  const calculateTotal = (rate: number, energy: number, sessionFee: number, gst: number) => {
    const subtotal = rate * energy + sessionFee;
    const gstAmount = subtotal * (gst / 100);
    return { subtotal: subtotal.toFixed(2), gstAmount: gstAmount.toFixed(2), total: (subtotal + gstAmount).toFixed(2) };
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
            Tariff Configuration
          </h1>
          <p className="text-sm text-gray-500 mt-1">Set charging rates and billing parameters</p>
        </div>
        <button
          onClick={() => { setFormData(emptyTariff); setFormErrors({}); setShowAddModal(true); }}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap flex items-center gap-2"
        >
          <div className="w-4 h-4 flex items-center justify-center">
            <i className="ri-add-line"></i>
          </div>
          Add Tariff
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tariffs.map((tariff) => {
          const example = calculateTotal(tariff.ratePerKwh, 30, tariff.sessionFee, tariff.gstPercent);
          return (
            <div
              key={tariff.id}
              className={`bg-white rounded-xl border p-5 transition-colors ${
                tariff.isActive ? "border-gray-200" : "border-gray-100 bg-gray-50/50"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{tariff.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    tariff.appliesTo === "DC Fast"
                      ? "bg-amber-50 text-amber-700 border border-amber-200"
                      : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}>
                    {tariff.appliesTo}
                  </span>
                </div>
                <button
                  onClick={() => toggleActive(tariff.id)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    tariff.isActive ? "bg-emerald-500" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      tariff.isActive ? "left-5" : "left-0.5"
                    }`}
                  ></span>
                </button>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">Rate per kWh</span>
                  <span className="text-xs font-semibold text-gray-900">&#8377;{tariff.ratePerKwh.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">Session Fee</span>
                  <span className="text-xs font-semibold text-gray-900">
                    {tariff.sessionFee > 0 ? `₹${tariff.sessionFee.toFixed(2)}` : "Free"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">GST</span>
                  <span className="text-xs font-semibold text-gray-900">{tariff.gstPercent}%</span>
                </div>
                <div className="border-t border-gray-100 pt-2 mt-2">
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-400">Example (30 kWh)</span>
                    <span className="text-xs font-semibold text-emerald-600">&#8377;{example.total}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium ${tariff.isActive ? "text-emerald-600" : "text-gray-400"}`}>
                  {tariff.isActive ? "Active" : "Inactive"}
                </span>
                <button
                  onClick={() => handleEdit(tariff.id)}
                  className="ml-auto px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-100 transition-colors whitespace-nowrap"
                >
                  Edit
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {(showAddModal || editTarget) && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => { setShowAddModal(false); setEditTarget(null); }}></div>
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {editTarget ? "Edit Tariff" : "Add New Tariff"}
              </h3>
              <div className="space-y-4">
                <FormField label="Tariff Name" error={formErrors.name} required>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className={inputClassName(!!formErrors.name)}
                    placeholder="e.g. DC Fast - Off-Peak"
                  />
                </FormField>
                <FormField label="Applies To" error={formErrors.appliesTo} required>
                  <select
                    value={formData.appliesTo}
                    onChange={(e) => setFormData({ ...formData, appliesTo: e.target.value })}
                    className={inputClassName(!!formErrors.appliesTo)}
                  >
                    <option value="DC Fast">DC Fast</option>
                    <option value="AC Slow">AC Slow</option>
                  </select>
                </FormField>
                <FormField label="Rate per kWh (₹)" error={formErrors.ratePerKwh} required>
                  <input
                    type="number"
                    value={formData.ratePerKwh}
                    onChange={(e) => setFormData({ ...formData, ratePerKwh: parseFloat(e.target.value) || 0 })}
                    className={inputClassName(!!formErrors.ratePerKwh)}
                    step="0.01"
                    min="0"
                  />
                </FormField>
                <FormField label="Session Fee (₹)" error={formErrors.sessionFee} required>
                  <input
                    type="number"
                    value={formData.sessionFee}
                    onChange={(e) => setFormData({ ...formData, sessionFee: parseFloat(e.target.value) || 0 })}
                    className={inputClassName(!!formErrors.sessionFee)}
                    step="0.01"
                    min="0"
                  />
                </FormField>
                <FormField label="GST (%)" error={formErrors.gstPercent} required>
                  <input
                    type="number"
                    value={formData.gstPercent}
                    onChange={(e) => setFormData({ ...formData, gstPercent: parseFloat(e.target.value) || 0 })}
                    className={inputClassName(!!formErrors.gstPercent)}
                    step="0.01"
                    min="0"
                    max="28"
                  />
                </FormField>
              </div>
              <div className="flex items-center gap-3 mt-6">
                <button onClick={() => { setShowAddModal(false); setEditTarget(null); }} className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap">Cancel</button>
                <button onClick={editTarget ? saveEdit : handleAdd} className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap">
                  {editTarget ? "Save Changes" : "Add Tariff"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}