import { paymentConfig, isRazorpayGateway } from "../config/paymentConfig";
import { requireSupabase } from "../utils/supabaseClient";
import { apiGet, apiPost, ApiNotConfiguredError } from "./apiClient";
import { requireUserId } from "./authService";
import { MINIMUM_WALLET_BALANCE_FOR_CHARGING } from "../config/walletConfig";
import type { CreateRazorpayOrderResponse } from "./razorpayService";
import type { WalletLedgerEntry, WalletSummary } from "../types";

export type RazorpayTopupVerifyPayload = {
  payment_order_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

export type TopupPaymentStatusResponse = {
  payment_order_id: string;
  amount: number;
  currency: string;
  status: string;
  wallet_credited: boolean;
  gateway_payment_id?: string | null;
  gateway_order_id?: string | null;
  gateway_name?: string | null;
  failure_reason?: string | null;
};

const RAZORPAY_FUNCTION_BY_PATH: Record<string, string> = {
  "/mobile/wallet/topup/create-razorpay-order": "ev-cms-mobile-wallet-create-razorpay-order",
  "/mobile/wallet/topup/verify-razorpay-payment": "ev-cms-mobile-wallet-verify-razorpay-payment",
};

async function readEdgeFunctionError(error: unknown): Promise<string> {
  if (!error || typeof error !== "object") return "PAYMENT_VERIFY_FAILED";

  const err = error as {
    message?: string;
    context?: { json?: () => Promise<unknown>; text?: () => Promise<string> };
  };

  if (err.context?.json) {
    try {
      const body = (await err.context.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      // fall through to text / message
    }
  }

  if (err.context?.text) {
    try {
      const text = await err.context.text();
      if (text) {
        try {
          const body = JSON.parse(text) as { error?: string };
          if (body?.error) return body.error;
        } catch {
          return text;
        }
      }
    } catch {
      // fall through
    }
  }

  return err.message || "PAYMENT_VERIFY_FAILED";
}

async function mobileWalletPost<T>(path: string, body: unknown): Promise<T> {
  if (paymentConfig.apiBaseUrl) {
    return apiPost<T>(path, body);
  }

  const functionName = RAZORPAY_FUNCTION_BY_PATH[path];
  if (!functionName) {
    throw new ApiNotConfiguredError();
  }

  const userId = requireUserId();
  const { data, error } = await requireSupabase().functions.invoke(functionName, {
    body: body as Record<string, unknown>,
    headers: { "X-User-Id": userId } as Record<string, string>,
  });

  if (error) {
    throw new Error(await readEdgeFunctionError(error));
  }

  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as { error: string }).error));
  }

  return data as T;
}

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

function mapPaymentOrderStatusRow(row: Record<string, unknown>) {
  return {
    paymentOrderId: row.payment_order_id as string,
    amount: Number(row.amount),
    currency: row.currency as string,
    status: row.status as string,
    walletCredited: Boolean(row.wallet_credited),
    failureReason: (row.failure_reason as string) ?? null,
    checkoutUrl: (row.checkout_url as string) ?? null,
    gatewayName: (row.gateway_name as string) ?? null,
    gatewayOrderId: (row.gateway_order_id as string) ?? null,
    gatewayPaymentId: (row.gateway_payment_id as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

async function getPaymentOrderStatusFromTable(paymentOrderId: string, userId: string) {
  const { data, error } = await requireSupabase()
    .from("EV_PaymentOrders")
    .select(
      "id, amount, currency, status, wallet_credited, failure_reason, checkout_url, gateway_name, gateway_order_id, gateway_payment_id, created_at, updated_at"
    )
    .eq("id", paymentOrderId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return mapPaymentOrderStatusRow({
    payment_order_id: row.id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    wallet_credited: row.wallet_credited,
    failure_reason: row.failure_reason,
    checkout_url: row.checkout_url,
    gateway_name: row.gateway_name,
    gateway_order_id: row.gateway_order_id,
    gateway_payment_id: row.gateway_payment_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
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
  gatewayOrderId?: string | null;
  gatewayPaymentId?: string | null;
  createdAt: string;
  updatedAt: string;
} | null> {
  const uid = userId ?? requireUserId();

  if (isRazorpayGateway() && (paymentConfig.apiBaseUrl || paymentConfig.supabaseUrl)) {
    try {
      const apiStatus = await getTopupPaymentStatus(paymentOrderId);
      if (apiStatus) {
        return {
          paymentOrderId: apiStatus.payment_order_id,
          amount: apiStatus.amount,
          currency: apiStatus.currency,
          status: apiStatus.status,
          walletCredited: apiStatus.wallet_credited,
          failureReason: apiStatus.failure_reason ?? null,
          checkoutUrl: null,
          gatewayName: apiStatus.gateway_name ?? "razorpay",
          gatewayOrderId: apiStatus.gateway_order_id ?? null,
          gatewayPaymentId: apiStatus.gateway_payment_id ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
    } catch (e) {
      if (!(e instanceof ApiNotConfiguredError)) {
        throw e;
      }
    }
  }

  const fromTable = await getPaymentOrderStatusFromTable(paymentOrderId, uid);
  if (fromTable) return fromTable;

  const { data, error } = await requireSupabase().rpc("ev_get_payment_order_status", {
    p_user_id: uid,
    p_payment_order_id: paymentOrderId,
  });
  if (error) throw error;
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;
  return mapPaymentOrderStatusRow(row);
}

/** Create Razorpay top-up order via backend (uses key_secret server-side only). */
export async function createRazorpayTopupOrder(amount: number): Promise<CreateRazorpayOrderResponse> {
  return mobileWalletPost<CreateRazorpayOrderResponse>("/mobile/wallet/topup/create-razorpay-order", {
    amount,
    currency: "INR",
    gateway_name: paymentConfig.gatewayName || "razorpay",
  });
}

/** Verify Razorpay payment signature on backend before wallet credit. */
export async function verifyRazorpayTopupPayment(
  payload: RazorpayTopupVerifyPayload
): Promise<TopupPaymentStatusResponse> {
  return mobileWalletPost<TopupPaymentStatusResponse>("/mobile/wallet/topup/verify-razorpay-payment", payload);
}

/** Fetch top-up payment status from backend. */
export async function getTopupPaymentStatus(paymentOrderId: string): Promise<TopupPaymentStatusResponse | null> {
  try {
    return await apiGet<TopupPaymentStatusResponse>(`/mobile/wallet/topup/status/${paymentOrderId}`);
  } catch (e) {
    if (e instanceof ApiNotConfiguredError) return null;
    throw e;
  }
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
