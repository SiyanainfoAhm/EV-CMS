import { useState, useMemo, useEffect, useCallback } from "react";
import * as paymentService from "@/services/paymentService";
import * as paymentGatewayService from "@/services/paymentGatewayService";
import type { Payment } from "@/types/ev";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { isPaymentMockEnabled } from "@/utils/paymentMockMode";

function shortId(value: string, length = 8): string {
  if (!value) return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

export default function PaymentsPage() {
  const { formatCurrency, formatDateTime } = useUserPreferences();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(searchQuery, 250);
  const mockMode = isPaymentMockEnabled();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadPayments = useCallback(() => {
    paymentService
      .getPayments({ status: statusFilter, search: debouncedSearch })
      .then(async (rows) => {
        setPayments(rows);
        const receiptMap: Record<string, string> = {};
        await Promise.all(
          rows
            .filter((p) => p.status === "success")
            .map(async (p) => {
              const r = await paymentService.getReceiptForPayment(p.id);
              if (r) receiptMap[p.id] = r.receiptNumber;
            })
        );
        setReceipts(receiptMap);
      })
      .catch((e) => showToast(e instanceof Error ? e.message : "Failed to load payments"));
  }, [statusFilter, debouncedSearch]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const stats = useMemo(() => {
    const success = payments.filter((p) => p.status === "success");
    const total = success.reduce((sum, p) => sum + p.totalAmount, 0);
    return {
      totalTransactions: payments.length,
      successfulPayments: success.length,
      pendingPayments: payments.filter((p) => p.status === "pending").length,
      totalRevenue: total,
    };
  }, [payments]);

  const runAction = async (paymentId: string, action: "verify" | "reconcile" | "receipt") => {
    setActionLoading(`${action}-${paymentId}`);
    try {
      if (action === "verify") {
        const result = await paymentGatewayService.verifyPayment(paymentId);
        showToast(result.verified ? `Payment verified (${result.gatewayTxnId})` : "Verification failed");
      } else if (action === "reconcile") {
        await paymentGatewayService.reconcilePayment(paymentId);
        showToast("Payment reconciled with gateway");
      } else {
        const result = await paymentGatewayService.generateReceipt(paymentId);
        showToast(`Receipt ${result.receiptNumber} generated`);
      }
      loadPayments();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-5 min-w-0 max-w-full">
      {toast && (
        <div className="fixed top-20 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-sm">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Payment Records
        </h1>
        <p className="text-sm text-gray-500 mt-1">Track all charging session payments and reconciliation status</p>
      </div>

      {mockMode && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <i className="ri-flask-line text-amber-600 text-lg mt-0.5"></i>
          <div className="min-w-0">
            <p className="text-sm font-medium text-amber-900">UAT mock payment gateway active</p>
            <p className="text-xs text-amber-800 mt-0.5">
              Verify pending payments, reconcile successful ones, and generate receipts. Set{" "}
              <code className="font-mono">VITE_PAYMENT_GATEWAY_URL</code> for live DFCCIL gateway.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-0">
          <p className="text-xs text-gray-500 mb-1 truncate">Total Transactions</p>
          <p className="text-2xl font-bold text-gray-900">{stats.totalTransactions}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-0">
          <p className="text-xs text-gray-500 mb-1 truncate">Successful</p>
          <p className="text-2xl font-bold text-emerald-600">{stats.successfulPayments}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-0">
          <p className="text-xs text-gray-500 mb-1 truncate">Pending</p>
          <p className="text-2xl font-bold text-amber-600">{stats.pendingPayments}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-0">
          <p className="text-xs text-gray-500 mb-1 truncate">Total Revenue</p>
          <p className="text-2xl font-bold text-rose-600 truncate">{formatCurrency(stats.totalRevenue)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 min-w-0 max-w-full overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-none min-w-0">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
                <input
                  type="text"
                  placeholder="Search by user or transaction ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full sm:w-64 pl-9 pr-4 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="all">All Status</option>
                <option value="success">Success</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
                <option value="refunded">Refunded</option>
              </select>
            </div>
            <p className="text-xs text-gray-400 shrink-0">{payments.length} records</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] table-fixed">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[16%]">
                  User
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[12%]">
                  Session
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[12%]">
                  Amount
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[10%]">
                  Gateway
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[12%]">
                  Txn ID
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[9%]">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[9%]">
                  Recon
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[11%]">
                  Date
                </th>
                {mockMode ? (
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider w-[11%]">
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => {
                const canVerify = mockMode && payment.status === "pending";
                const canReconcile =
                  mockMode && payment.status === "success" && payment.reconciliation !== "matched";
                const canReceipt = mockMode && payment.status === "success" && !receipts[payment.id];
                const busy = actionLoading?.endsWith(payment.id) ?? false;

                return (
                  <tr key={payment.id} className="border-b border-gray-50 hover:bg-[#f9faf7] transition-colors">
                    <td className="px-4 py-3.5 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate" title={payment.userName}>
                        {payment.userName || "—"}
                      </p>
                      <p className="text-[10px] font-mono text-gray-400 truncate" title={payment.id}>
                        {shortId(payment.id)}
                      </p>
                    </td>
                    <td className="px-4 py-3.5 min-w-0">
                      <span className="text-xs font-mono text-gray-500 truncate block" title={payment.sessionId}>
                        {shortId(payment.sessionId, 10)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{formatCurrency(payment.totalAmount)}</p>
                      <p className="text-[10px] text-gray-400 truncate">
                        {formatCurrency(payment.amount)} + {formatCurrency(payment.gstAmount)} GST
                      </p>
                    </td>
                    <td className="px-4 py-3.5 min-w-0">
                      <p className="text-sm text-gray-600 truncate">{payment.gateway || "—"}</p>
                    </td>
                    <td className="px-4 py-3.5 min-w-0">
                      <p className="text-xs font-mono text-gray-400 truncate" title={payment.gatewayTxnId ?? undefined}>
                        {payment.gatewayTxnId ? shortId(payment.gatewayTxnId, 12) : "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                          payment.status === "success"
                            ? "bg-emerald-100 text-emerald-700"
                            : payment.status === "pending"
                              ? "bg-amber-100 text-amber-700"
                              : payment.status === "failed"
                                ? "bg-red-100 text-red-700"
                                : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {payment.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                          payment.reconciliation === "matched"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {payment.reconciliation || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 min-w-0">
                      <p className="text-sm text-gray-500 whitespace-nowrap">{formatDateTime(payment.createdAt)}</p>
                      {receipts[payment.id] ? (
                        <p className="text-[10px] text-emerald-600 truncate" title={receipts[payment.id]}>
                          {receipts[payment.id]}
                        </p>
                      ) : null}
                    </td>
                    {mockMode ? (
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-1">
                          {canVerify ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => runAction(payment.id, "verify")}
                              className="text-xs font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-50 text-left"
                            >
                              Verify
                            </button>
                          ) : null}
                          {canReconcile ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => runAction(payment.id, "reconcile")}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 text-left"
                            >
                              Reconcile
                            </button>
                          ) : null}
                          {canReceipt ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => runAction(payment.id, "receipt")}
                              className="text-xs font-medium text-violet-600 hover:text-violet-700 disabled:opacity-50 text-left"
                            >
                              Receipt
                            </button>
                          ) : null}
                          {!canVerify && !canReconcile && !canReceipt ? (
                            <span className="text-xs text-gray-300">—</span>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {payments.length === 0 && (
          <div className="py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-gray-100 mx-auto mb-3">
              <i className="ri-bank-card-line text-gray-300 text-xl"></i>
            </div>
            <p className="text-sm text-gray-400">No payments found</p>
          </div>
        )}
      </div>
    </div>
  );
}
