import { useState, useMemo, useEffect } from "react";
import * as paymentService from "@/services/paymentService";
import type { Payment } from "@/types/ev";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  useEffect(() => {
    paymentService.getPayments({ status: statusFilter, search: debouncedSearch }).then(setPayments).catch(console.error);
  }, [statusFilter, debouncedSearch]);

  const filteredPayments = useMemo(() => {
    // Data already filtered server-side; keep memo for rendering.
    return payments;
  }, [payments, statusFilter, searchQuery]);

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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Payment Records
        </h1>
        <p className="text-sm text-gray-500 mt-1">Track all charging session payments and reconciliation status</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Total Transactions</p>
          <p className="text-2xl font-bold text-gray-900">{stats.totalTransactions}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Successful</p>
          <p className="text-2xl font-bold text-emerald-600">{stats.successfulPayments}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Pending</p>
          <p className="text-2xl font-bold text-amber-600">{stats.pendingPayments}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Total Revenue</p>
          <p className="text-2xl font-bold text-rose-600">&#8377;{stats.totalRevenue.toLocaleString()}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
                <input
                  type="text"
                  placeholder="Search by user or transaction ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
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
            <p className="text-xs text-gray-400">{filteredPayments.length} records</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Payment ID</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">User</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Session</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Amount</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">GST</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Total</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Gateway</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Txn ID</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Recon</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredPayments.map((payment) => (
                <tr key={payment.id} className="border-b border-gray-50 hover:bg-[#f9faf7] transition-colors">
                  <td className="px-5 py-3.5">
                    <span className="text-sm font-mono text-gray-500">{payment.id}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-medium text-gray-900">{payment.userName}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm font-mono text-gray-500">{payment.sessionId}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm text-gray-700">&#8377;{payment.amount.toFixed(2)}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm text-gray-700">&#8377;{payment.gstAmount.toFixed(2)}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-semibold text-gray-900">&#8377;{payment.totalAmount.toFixed(2)}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm text-gray-600">{payment.gateway || "—"}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-xs font-mono text-gray-400 max-w-32 truncate">
                      {payment.gatewayTxnId || "—"}
                    </p>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
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
                  <td className="px-5 py-3.5">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        payment.reconciliation === "matched"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {payment.reconciliation || "—"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm text-gray-500">{formatTime(payment.createdAt)}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredPayments.length === 0 && (
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