import { useState } from "react";
import * as chargerService from "@/services/chargerService";
import type { Charger } from "@/types/ev";

const CSV_TEMPLATE = `charge_point_id,name,manufacturer,charger_type,max_power_kw,location
MP-DC-001,Depot Bay 1,Massive Power,DC Fast,60,Mumbai Central Depot
MP-AC-002,Yard Charger 2,Tri Square,AC Slow,7.4,Pune Logistics Yard`;

export interface BulkImportRow {
  chargePointId: string;
  name: string;
  manufacturer: string;
  chargerType: "DC Fast" | "AC Slow";
  maxPowerKw: number;
  location: string;
  line: number;
}

export interface BulkImportResult {
  created: Charger[];
  errors: { line: number; chargePointId: string; message: string }[];
}

function parseCsv(text: string): BulkImportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const required = ["charge_point_id", "name", "manufacturer", "charger_type", "max_power_kw", "location"];
  for (const col of required) {
    if (idx(col) < 0) throw new Error(`Missing column: ${col}`);
  }

  const rows: BulkImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",").map((p) => p.trim());
    const type = parts[idx("charger_type")] as "DC Fast" | "AC Slow";
    if (type !== "DC Fast" && type !== "AC Slow") {
      throw new Error(`Line ${i + 1}: charger_type must be "DC Fast" or "AC Slow"`);
    }
    const power = parseFloat(parts[idx("max_power_kw")]);
    if (!Number.isFinite(power) || power <= 0) {
      throw new Error(`Line ${i + 1}: invalid max_power_kw`);
    }
    rows.push({
      chargePointId: parts[idx("charge_point_id")].toUpperCase(),
      name: parts[idx("name")],
      manufacturer: parts[idx("manufacturer")],
      chargerType: type,
      maxPowerKw: power,
      location: parts[idx("location")],
      line: i + 1,
    });
  }
  return rows;
}

interface ChargerBulkImportModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: (result: BulkImportResult) => void;
}

export function ChargerBulkImportModal({ open, onClose, onComplete }: ChargerBulkImportModalProps) {
  const [csvText, setCsvText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  if (!open) return null;

  const handleImport = async () => {
    setParseError(null);
    let rows: BulkImportRow[];
    try {
      rows = parseCsv(csvText);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid CSV");
      return;
    }
    if (rows.length === 0) {
      setParseError("No data rows found. Paste CSV with a header row plus at least one charger.");
      return;
    }

    setImporting(true);
    setProgress({ done: 0, total: rows.length });
    const created: Charger[] = [];
    const errors: BulkImportResult["errors"] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const charger = await chargerService.createCharger({
          chargePointId: row.chargePointId,
          name: row.name,
          manufacturer: row.manufacturer,
          chargerType: row.chargerType,
          maxPowerKw: row.maxPowerKw,
          location: row.location,
        });
        created.push(charger);
      } catch (e) {
        errors.push({
          line: row.line,
          chargePointId: row.chargePointId,
          message: e instanceof Error ? e.message : "Import failed",
        });
      }
      setProgress({ done: i + 1, total: rows.length });
    }

    setImporting(false);
    onComplete({ created, errors });
    if (errors.length === 0) onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !importing && onClose()} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] flex flex-col">
          <div className="p-6 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Bulk Import Chargers</h3>
            <p className="text-xs text-gray-500 mt-1">
              Paste CSV with columns: charge_point_id, name, manufacturer, charger_type, max_power_kw, location
            </p>
          </div>
          <div className="p-6 flex-1 overflow-y-auto space-y-3">
            <button
              type="button"
              disabled={importing}
              onClick={() => setCsvText(CSV_TEMPLATE)}
              className="text-xs text-emerald-600 hover:underline"
            >
              Load example template
            </button>
            <textarea
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setParseError(null);
              }}
              disabled={importing}
              rows={12}
              placeholder={CSV_TEMPLATE}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            {parseError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{parseError}</p>
            )}
            {importing && (
              <p className="text-sm text-gray-500">
                Importing {progress.done} / {progress.total}…
              </p>
            )}
          </div>
          <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={importing}
              className="px-4 py-2 text-sm text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={importing || !csvText.trim()}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-60"
            >
              {importing ? "Importing…" : "Import Chargers"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
