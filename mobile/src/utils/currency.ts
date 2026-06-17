/** Round to 2 decimal places for money values. */
export function toMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Parse user amount input; returns null if invalid. */
export function parseAmountInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return toMoney(n);
}

/** Format amount as Indian Rupees. */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toMoney(amount));
}
