import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import { MINIMUM_WALLET_BALANCE_FOR_CHARGING } from "../config/walletConfig";
import type { WalletLedgerEntry, WalletSummary } from "../types";

function mapLedgerRow(row: Record<string, unknown>): WalletLedgerEntry {
  return {
    id: row.id as string,
    walletAccountId: row.wallet_account_id as string,
    transactionType: row.transaction_type as string,
    amount: Number(row.amount),
    balanceBefore: Number(row.balance_before),
    balanceAfter: Number(row.balance_after),
    referenceType: row.reference_type as string,
    referenceId: (row.reference_id as string) ?? null,
    remarks: (row.remarks as string) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapSummaryRow(row: Record<string, unknown>): WalletSummary {
  return {
    walletAccountId: row.wallet_account_id as string,
    balanceAmount: Number(row.balance_amount),
    holdAmount: Number(row.hold_amount),
    usableBalance: Number(row.usable_balance),
    currency: row.currency as string,
    status: row.status as string,
  };
}

export async function getWalletSummary(userId?: string): Promise<WalletSummary | null> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase().rpc("ev_get_wallet_summary", {
    p_user_id: uid,
  });
  if (error) throw error;
  const row = (data as Record<string, unknown>[] | null)?.[0];
  return row ? mapSummaryRow(row) : null;
}

export async function getWalletLedger(
  options: { userId?: string; limit?: number; filter?: string } = {}
): Promise<WalletLedgerEntry[]> {
  const uid = options.userId ?? requireUserId();
  const { data, error } = await requireSupabase().rpc("ev_get_wallet_ledger", {
    p_user_id: uid,
    p_limit: options.limit ?? 50,
    p_filter: options.filter ?? "all",
  });
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map(mapLedgerRow);
}

export async function createTopupOrder(
  amount: number,
  gatewayName?: string
): Promise<{ paymentOrderId: string; amount: number; status: string; message: string }> {
  const uid = requireUserId();
  const { data, error } = await requireSupabase().rpc("ev_create_topup_order", {
    p_user_id: uid,
    p_amount: amount,
    p_gateway_name: gatewayName ?? null,
  });
  if (error) throw error;
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) throw new Error("TOPUP_ORDER_FAILED");
  return {
    paymentOrderId: row.payment_order_id as string,
    amount: Number(row.amount),
    status: row.status as string,
    message: row.message as string,
  };
}

export async function getPaymentOrderStatus(
  paymentOrderId: string,
  userId?: string
): Promise<{
  paymentOrderId: string;
  amount: number;
  currency: string;
  status: string;
  walletCredited: boolean;
  failureReason?: string | null;
  checkoutUrl?: string | null;
  gatewayName?: string | null;
  createdAt: string;
  updatedAt: string;
} | null> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase().rpc("ev_get_payment_order_status", {
    p_user_id: uid,
    p_payment_order_id: paymentOrderId,
  });
  if (error) throw error;
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;
  return {
    paymentOrderId: row.payment_order_id as string,
    amount: Number(row.amount),
    currency: row.currency as string,
    status: row.status as string,
    walletCredited: Boolean(row.wallet_credited),
    failureReason: (row.failure_reason as string) ?? null,
    checkoutUrl: (row.checkout_url as string) ?? null,
    gatewayName: (row.gateway_name as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function refreshWallet(userId?: string): Promise<WalletSummary | null> {
  return getWalletSummary(userId);
}

/** Block charging when wallet is missing, blocked, or below minimum usable balance. */
export async function assertWalletReadyForCharging(userId?: string): Promise<WalletSummary> {
  const uid = userId ?? requireUserId();
  let summary: WalletSummary | null;
  try {
    summary = await getWalletSummary(uid);
  } catch {
    throw new Error("WALLET_NOT_FOUND");
  }
  if (!summary) throw new Error("WALLET_NOT_FOUND");
  if (summary.status !== "active") throw new Error("WALLET_BLOCKED");
  if (summary.usableBalance < MINIMUM_WALLET_BALANCE_FOR_CHARGING) {
    throw new Error("WALLET_LOW_BALANCE");
  }
  return summary;
}
