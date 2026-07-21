/**
 * EV rate helpers for prepaid time-plan estimates.
 * Prefer live tariff from EV_Tariffs; fall back to Noida/UP default.
 */
import * as tariffService from "../services/tariffService";

export const DEFAULT_EV_RATE_PER_KWH = 7.7;

export const DEFAULT_AC_FALLBACK_KW = 7.4;
export const DEFAULT_DC_FALLBACK_KW = 60;

let cachedRatePerKwh: number | null = null;

/** Temporary override for tests / local config. */
export function setEvRatePerKwhCache(rate: number | null): void {
  cachedRatePerKwh = rate;
}

/**
 * Returns ₹/kWh for prepaid time estimates.
 * Prefer getEvRatePerKwhAsync() which reads EV_Tariffs.
 */
export function getEvRatePerKwh(): number {
  if (cachedRatePerKwh != null && cachedRatePerKwh > 0) return cachedRatePerKwh;
  const fromEnv = Number(process.env.EXPO_PUBLIC_DEFAULT_EV_RATE_PER_KWH);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_EV_RATE_PER_KWH;
}

export async function getEvRatePerKwhAsync(): Promise<number> {
  try {
    const tariff = await tariffService.getActiveChargingTariff();
    if (tariff && tariff.ratePerKwh > 0) {
      cachedRatePerKwh = tariff.ratePerKwh;
      return tariff.ratePerKwh;
    }
  } catch {
    // fall through to default
  }
  return getEvRatePerKwh();
}
