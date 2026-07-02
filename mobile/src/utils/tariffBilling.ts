/**
 * Session billing from tariff settings — do not hardcode rates in payment flows.
 * Source of truth: EV_Tariffs (admin web → Tariffs page).
 */

export type TariffBillInput = {
  ratePerKwh: number;
  gstPercent: number;
};

export type TariffBillResult = {
  amount: number;
  gstAmount: number;
  totalAmount: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** consumed kWh × rate; GST when gstPercent > 0 */
export function calculateSessionBillFromTariff(
  energyKwh: number,
  tariff: TariffBillInput
): TariffBillResult {
  const energy = Math.max(0, energyKwh);
  const amount = round2(energy * tariff.ratePerKwh);
  const gstAmount =
    tariff.gstPercent > 0 ? round2((amount * tariff.gstPercent) / 100) : 0;
  return {
    amount,
    gstAmount,
    totalAmount: round2(amount + gstAmount),
  };
}
