/** Minimum usable wallet balance (INR) required before starting a charge session. */
export const MINIMUM_WALLET_BALANCE_FOR_CHARGING = 100;

export const TOPUP_MIN_AMOUNT = 100;

export const TOPUP_QUICK_AMOUNTS = [100, 200, 500, 1000] as const;

export type TopupPaymentMethod = "upi" | "card" | "netbanking" | "gateway";

export const TOPUP_PAYMENT_METHODS: TopupPaymentMethod[] = ["upi", "card", "netbanking", "gateway"];
