/**
 * Charger power fallbacks for prepaid time estimates when max_power_kw is missing.
 * Tariff rates must come from EV_Tariffs via tariffService.getTariffForCharger().
 */
import * as tariffService from "../services/tariffService";

/** Government reference only — not used in normal prepaid checkout. */
export const LEGACY_GOVERNMENT_REFERENCE_RATE_PER_KWH = 7.7;

/** @deprecated Use LEGACY_GOVERNMENT_REFERENCE_RATE_PER_KWH */
export const DEFAULT_EV_RATE_PER_KWH = LEGACY_GOVERNMENT_REFERENCE_RATE_PER_KWH;

export const DEFAULT_AC_FALLBACK_KW = 7.4;
export const DEFAULT_DC_FALLBACK_KW = 60;

let cachedRatePerKwh: number | null = null;

/** Temporary override for tests / local config. */
export function setEvRatePerKwhCache(rate: number | null): void {
  cachedRatePerKwh = rate;
}

/**
 * @deprecated Do not use for prepaid payment. Use tariffService.getTariffForCharger().
 */
export function getEvRatePerKwh(): number {
  if (cachedRatePerKwh != null && cachedRatePerKwh > 0) return cachedRatePerKwh;
  const fromEnv = Number(process.env.EXPO_PUBLIC_DEFAULT_EV_RATE_PER_KWH);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return LEGACY_GOVERNMENT_REFERENCE_RATE_PER_KWH;
}

/** @deprecated Use getTariffForCharger(charger) for prepaid flows. */
export async function getEvRatePerKwhAsync(): Promise<number> {
  try {
    const tariff = await tariffService.getActiveChargingTariff();
    if (tariff && tariff.ratePerKwh > 0) {
      cachedRatePerKwh = tariff.ratePerKwh;
      return tariff.ratePerKwh;
    }
  } catch {
    // fall through
  }
  return getEvRatePerKwh();
}
