import type { PaymentOrder, WalletAccount, WalletLedgerEntry } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { getEvUserLookup } from "@/utils/evUserLookup";
import { isoDayEnd, isoDayStart } from "@/utils/dateRanges";

export interface WalletAccountsQuery {
  search?: string;
  status?: string;
  limit?: number;
}

export interface PaymentOrdersQuery {
  search?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

function mapWalletAccount(row: Record<string, unknown>, user?: Record<string, unknown> | null): WalletAccount {
  const balance = Number(row.balance_amount ?? 0);
  const hold = Number(row.hold_amount ?? 0);
  return {
    id: row.id as string,
    userId: row.user_id as string,
    userName: (user?.full_name as string) ?? "—",
    userEmail: (user?.email as string) ?? "",
    balanceAmount: balance,
    holdAmount: hold,
    usableBalance: balance - hold,
    currency: (row.currency as string) ?? "INR",
    status: row.status as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapPaymentOrder(row: Record<string, unknown>, user?: Record<string, unknown> | null): PaymentOrder {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    userName: (user?.full_name as string) ?? "—",
    userEmail: (user?.email as string) ?? "",
    amount: Number(row.amount),
    currency: (row.currency as string) ?? "INR",
    gatewayName: (row.gateway_name as string) ?? null,
    gatewayOrderId: (row.gateway_order_id as string) ?? null,
    gatewayPaymentId: (row.gateway_payment_id as string) ?? null,
    checkoutUrl: (row.checkout_url as string) ?? null,
    status: row.status as string,
    walletCredited: Boolean(row.wallet_credited),
    failureReason: (row.failure_reason as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapLedgerEntry(row: Record<string, unknown>): WalletLedgerEntry {
  return {
    id: row.id as string,
    walletAccountId: row.wallet_account_id as string,
    userId: row.user_id as string,
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

function matchesSearch(text: string, search: string): boolean {
  return text.toLowerCase().includes(search.toLowerCase());
}

export async function getWalletAccounts(query: WalletAccountsQuery = {}): Promise<WalletAccount[]> {
  const { search = "", status = "all", limit = 200 } = query;
  let q = requireSupabase()
    .from("EV_WalletAccounts")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (status !== "all") q = q.eq("status", status);

  const [{ data, error }, userLookup] = await Promise.all([q, getEvUserLookup()]);
  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Cannot load wallets: run supabase/payments_wallet_admin.sql on Supabase."
        : error.message
    );
  }

  let rows = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const user = userLookup.get(r.user_id as string);
    return mapWalletAccount(r, user ?? null);
  });

  const s = search.trim();
  if (s) {
    rows = rows.filter(
      (w) =>
        matchesSearch(w.userName, s) ||
        matchesSearch(w.userEmail, s) ||
        matchesSearch(w.id, s) ||
        matchesSearch(w.userId, s)
    );
  }

  return rows;
}

export async function getWalletLedgerForUser(userId: string, limit = 50): Promise<WalletLedgerEntry[]> {
  const { data, error } = await requireSupabase()
    .from("EV_WalletLedger")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => mapLedgerEntry(row as Record<string, unknown>));
}

export async function getPaymentOrders(query: PaymentOrdersQuery = {}): Promise<PaymentOrder[]> {
  const { search = "", status = "all", dateFrom, dateTo, limit = 200 } = query;
  let q = requireSupabase()
    .from("EV_PaymentOrders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status !== "all") q = q.eq("status", status);
  if (dateFrom) q = q.gte("created_at", isoDayStart(dateFrom));
  if (dateTo) q = q.lte("created_at", isoDayEnd(dateTo));

  const [{ data, error }, userLookup] = await Promise.all([q, getEvUserLookup()]);
  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Cannot load top-up orders: run supabase/payments_wallet_admin.sql on Supabase."
        : error.message
    );
  }

  let rows = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const user = userLookup.get(r.user_id as string);
    return mapPaymentOrder(r, user ?? null);
  });

  const s = search.trim();
  if (s) {
    rows = rows.filter(
      (o) =>
        matchesSearch(o.userName, s) ||
        matchesSearch(o.userEmail, s) ||
        matchesSearch(o.id, s) ||
        matchesSearch(o.gatewayOrderId ?? "", s) ||
        matchesSearch(o.gatewayPaymentId ?? "", s)
    );
  }

  return rows;
}

export async function getPaymentOrderById(id: string): Promise<PaymentOrder | undefined> {
  const [{ data, error }, userLookup] = await Promise.all([
    requireSupabase().from("EV_PaymentOrders").select("*").eq("id", id).maybeSingle(),
    getEvUserLookup(),
  ]);

  if (error) throw error;
  if (!data) return undefined;
  const r = data as Record<string, unknown>;
  const user = userLookup.get(r.user_id as string);
  return mapPaymentOrder(r, user ?? null);
}

export async function getWalletBalanceMap(): Promise<
  Map<string, { usableBalance: number; balanceAmount: number; status: string }>
> {
  const accounts = await getWalletAccounts({ limit: 500 });
  const map = new Map<string, { usableBalance: number; balanceAmount: number; status: string }>();
  for (const account of accounts) {
    map.set(account.userId, {
      usableBalance: account.usableBalance,
      balanceAmount: account.balanceAmount,
      status: account.status,
    });
  }
  return map;
}
