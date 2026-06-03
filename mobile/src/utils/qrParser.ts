export interface QrChargeTarget {
  chargerId?: string;
  chargePointId?: string;
  connectorId: number;
}

/** Parse QR payloads: JSON, evcms:// URL, or CHARGE_POINT:connector */
export function parseChargeQr(raw: string): QrChargeTarget | null {
  const text = raw.trim();
  if (!text) return null;

  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const connectorId = Number(json.connectorId ?? json.connector_id ?? 1);
    if (json.chargerId || json.charger_id) {
      return {
        chargerId: String(json.chargerId ?? json.charger_id),
        connectorId: Number.isFinite(connectorId) ? connectorId : 1,
      };
    }
    if (json.chargePointId || json.charge_point_id) {
      return {
        chargePointId: String(json.chargePointId ?? json.charge_point_id),
        connectorId: Number.isFinite(connectorId) ? connectorId : 1,
      };
    }
  } catch {
    // not JSON
  }

  const urlMatch = text.match(/evcms:\/\/charger\/([^/]+)\/connector\/(\d+)/i);
  if (urlMatch) {
    return { chargerId: urlMatch[1], connectorId: Number(urlMatch[2]) || 1 };
  }

  const colon = text.match(/^([A-Za-z0-9-]+):(\d+)$/);
  if (colon) {
    return { chargePointId: colon[1], connectorId: Number(colon[2]) || 1 };
  }

  return null;
}
