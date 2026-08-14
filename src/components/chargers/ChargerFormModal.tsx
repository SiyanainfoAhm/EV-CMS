import { useEffect, useState } from "react";
import { FormField, inputClassName } from "@/components/ui/FormField";
import {
  hasErrors,
  validateChargerEditForm,
  validateChargerForm,
  type ChargerFormFields,
} from "@/utils/validation";
import { buildOcppWebSocketUrl, getOcppPathPattern } from "@/utils/ocppUrls";
import { useOcppGatewayConfig } from "@/hooks/useOcppGatewayConfig";
import { useAuth } from "@/hooks/useAuth";
import * as chargerService from "@/services/chargerService";
import * as tariffService from "@/services/tariffService";
import * as auditLogService from "@/services/auditLogService";
import type { Charger, Tariff } from "@/types/ev";

export const emptyChargerForm: ChargerFormFields = {
  chargePointId: "",
  name: "",
  displayName: "",
  manufacturer: "MyPower Experts",
  model: "",
  serialNumber: "",
  firmwareVersion: "v1.0.0",
  chargerType: "DC Fast",
  maxPowerKw: 60,
  location: "",
  tariffId: "",
  allowAdminBypass: true,
};

export function chargerToForm(charger: Charger): ChargerFormFields {
  return {
    chargePointId: charger.chargePointId,
    name: charger.name,
    displayName: charger.displayName ?? "",
    manufacturer: charger.manufacturer,
    model: charger.model,
    serialNumber: charger.serialNumber,
    firmwareVersion: charger.firmwareVersion,
    chargerType: charger.type,
    maxPowerKw: charger.maxPowerKw,
    location: charger.location,
    tariffId: charger.tariffId ?? "",
    allowAdminBypass: charger.allowAdminBypass !== false,
  };
}

function defaultPowerKw(chargerType: string, manufacturer: string): number {
  if (chargerType === "DC Fast") return 60;
  return manufacturer === "Tri Square" ? 7.4 : 7.5;
}

interface ChargerFormModalProps {
  open: boolean;
  mode: "add" | "edit";
  editingId?: string;
  initialForm?: ChargerFormFields;
  onClose: () => void;
  onSaved: (charger: Charger) => void;
  onError: (message: string) => void;
}

export function ChargerFormModal({
  open,
  mode,
  editingId,
  initialForm = emptyChargerForm,
  onClose,
  onSaved,
  onError,
}: ChargerFormModalProps) {
  const { user } = useAuth();
  const [formData, setFormData] = useState<ChargerFormFields>(initialForm);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof ChargerFormFields, string>>>({});
  const [saving, setSaving] = useState(false);
  const [typeTariffs, setTypeTariffs] = useState<Tariff[]>([]);
  const [defaultTariff, setDefaultTariff] = useState<Tariff | null>(null);
  const { ready: ocppConfigReady, isConfigured: ocppConfigured } = useOcppGatewayConfig();

  useEffect(() => {
    if (open) {
      setFormData(initialForm);
      setFormErrors({});
    }
  }, [open, initialForm]);

  useEffect(() => {
    if (!open) return;
    void Promise.all([
      tariffService.getTariffsForChargerType(formData.chargerType),
      tariffService.getActiveTariffByType(formData.chargerType),
    ]).then(([list, def]) => {
      setTypeTariffs(list);
      setDefaultTariff(def);
    });
  }, [open, formData.chargerType]);

  if (!open) return null;

  const isEdit = mode === "edit";

  const updateChargerType = (chargerType: string) => {
    setFormData((prev) => ({
      ...prev,
      chargerType,
      maxPowerKw: defaultPowerKw(chargerType, prev.manufacturer),
      tariffId: "",
    }));
  };

  const updateManufacturer = (manufacturer: string) => {
    setFormData((prev) => ({
      ...prev,
      manufacturer,
      maxPowerKw: defaultPowerKw(prev.chargerType, manufacturer),
    }));
  };

  const handleSubmit = async () => {
    const errors = isEdit ? validateChargerEditForm(formData) : validateChargerForm(formData);
    setFormErrors(errors);
    if (hasErrors(errors)) return;

    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        displayName: formData.displayName.trim() || null,
        manufacturer: formData.manufacturer,
        model: formData.model || undefined,
        serialNumber: formData.serialNumber || undefined,
        firmwareVersion: formData.firmwareVersion || undefined,
        chargerType: formData.chargerType as "DC Fast" | "AC Slow",
        maxPowerKw: formData.maxPowerKw,
        location: formData.location,
        tariffId: formData.tariffId || null,
        allowAdminBypass: Boolean(formData.allowAdminBypass),
      };

      const saved =
        isEdit && editingId
          ? await chargerService.updateCharger(editingId, payload)
          : await chargerService.createCharger({ chargePointId: formData.chargePointId, ...payload });

      const prevBypass = Boolean(initialForm.allowAdminBypass);
      const nextBypass = Boolean(payload.allowAdminBypass);
      if (user?.id && (nextBypass !== prevBypass || (!isEdit && nextBypass))) {
        void auditLogService.logWebAdminStartFlagChange({
          userId: user.id,
          chargerId: saved.id,
          chargePointId: saved.chargePointId,
          enabled: nextBypass,
          isCreate: !isEdit,
        });
      }

      onSaved(saved);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save charger");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose}></div>
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4 overflow-y-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-2xl my-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            {isEdit ? "Edit Charger" : "Add New Charger"}
          </h3>
          <p className="text-xs text-gray-500 mb-5">
            {isEdit
              ? "Update charger details. Charge point ID cannot be changed after registration."
              : "Register a physical charge point for OCPP onboarding and fleet management."}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Charge Point ID" error={formErrors.chargePointId} required={!isEdit}>
              <input
                type="text"
                value={formData.chargePointId}
                onChange={(e) => setFormData({ ...formData, chargePointId: e.target.value.toUpperCase() })}
                className={`${inputClassName(!!formErrors.chargePointId)} ${isEdit ? "opacity-70 cursor-not-allowed" : ""}`}
                placeholder="e.g. MP-DC-013"
                disabled={isEdit}
                readOnly={isEdit}
              />
            </FormField>
            <FormField label="Name" error={formErrors.name} required>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={inputClassName(!!formErrors.name)}
                placeholder="e.g. DL-DC-Charger-001"
              />
            </FormField>
            <FormField label="Public display name (optional)">
              <input
                type="text"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                className={inputClassName()}
                placeholder="Leave blank to show Name"
              />
            </FormField>
            <FormField label="Manufacturer" error={formErrors.manufacturer} required>
              <select
                value={formData.manufacturer}
                onChange={(e) => updateManufacturer(e.target.value)}
                className={inputClassName(!!formErrors.manufacturer)}
              >
                <option value="MyPower Experts">MyPower Experts</option>
                <option value="Tri Square">Tri Square</option>
              </select>
            </FormField>
            <FormField label="Charger Type" error={formErrors.chargerType} required>
              <select
                value={formData.chargerType}
                onChange={(e) => updateChargerType(e.target.value)}
                className={inputClassName(!!formErrors.chargerType)}
              >
                <option value="DC Fast">DC Fast</option>
                <option value="AC Slow">AC Slow</option>
              </select>
            </FormField>
            <FormField label="Model">
              <input
                type="text"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                className={inputClassName()}
                placeholder="Auto-filled if blank"
              />
            </FormField>
            <FormField label="Max Power (kW)" error={formErrors.maxPowerKw} required>
              <input
                type="number"
                min={1}
                step={0.1}
                value={formData.maxPowerKw}
                onChange={(e) => setFormData({ ...formData, maxPowerKw: Number(e.target.value) })}
                className={inputClassName(!!formErrors.maxPowerKw)}
              />
            </FormField>
            <FormField label="Serial Number">
              <input
                type="text"
                value={formData.serialNumber}
                onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                className={inputClassName()}
                placeholder="Optional"
              />
            </FormField>
            <FormField label="Firmware Version">
              <input
                type="text"
                value={formData.firmwareVersion}
                onChange={(e) => setFormData({ ...formData, firmwareVersion: e.target.value })}
                className={inputClassName()}
              />
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Tariff">
                <select
                  value={formData.tariffId}
                  onChange={(e) => setFormData({ ...formData, tariffId: e.target.value })}
                  className={inputClassName()}
                >
                  <option value="">
                    Type default
                    {defaultTariff ? ` — ${defaultTariff.name} (${tariffService.formatTariffSummary(defaultTariff)})` : ""}
                  </option>
                  {typeTariffs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {tariffService.formatTariffSummary(t)}
                    </option>
                  ))}
                </select>
              </FormField>
              <p className="text-xs text-gray-400 mt-1">
                Assign a custom tariff for this charger, or use the active {formData.chargerType} default from Tariffs.
              </p>
            </div>
            <div className="sm:col-span-2">
              <FormField label="Location" error={formErrors.location} required>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className={inputClassName(!!formErrors.location)}
                  placeholder="e.g. DFCCIL Yard, New Delhi"
                />
              </FormField>
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(formData.allowAdminBypass)}
                  onChange={(e) =>
                    setFormData({ ...formData, allowAdminBypass: e.target.checked })
                  }
                  className="mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>
                  <span className="text-sm font-medium text-gray-900">
                    Allow Web Admin Start / Stop
                  </span>
                  <span className="block text-xs text-gray-600 mt-0.5">
                    Allows SuperAdmin/SiteAdmin to start or stop this charger from the web panel
                    using ADMIN-BYPASS. Mobile users and RFID charging are unaffected.
                  </span>
                </span>
              </label>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-4">
            {isEdit
              ? formData.chargerType === "DC Fast"
                ? "DC Fast chargers have 2 CCS2 connectors. Changing type recreates connectors."
                : "AC Slow chargers have 1 Type2 connector. Changing type recreates connectors."
              : formData.chargerType === "DC Fast"
                ? "Creates 2 CCS2 connectors (guns) at half the max power each."
                : "Creates 1 Type2 connector. Charger starts offline until OCPP BootNotification."}
          </p>
          {formData.chargePointId.trim() ? (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
              <p className="text-xs text-gray-500 mb-1">OCPP WebSocket URL (configure on charger)</p>
              {ocppConfigReady && ocppConfigured ? (
                <code className="text-xs text-emerald-700 break-all">{buildOcppWebSocketUrl(formData.chargePointId)}</code>
              ) : ocppConfigReady ? (
                <p className="text-xs text-amber-700">
                  Not configured — set <strong>VITE_OCPP_GATEWAY_API_URL</strong> in Vercel and{" "}
                  <strong>redeploy</strong>, or edit <code className="text-[10px]">public/app-config.json</code>{" "}
                  (<code className="text-[10px]">ocppGatewayApiUrl</code>). Use your OCPP gateway host (not the Vercel
                  admin URL). Pattern: <code className="text-[10px]">{getOcppPathPattern()}</code>
                </p>
              ) : (
                <p className="text-xs text-gray-400">Loading gateway config…</p>
              )}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-3 mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Charger"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
