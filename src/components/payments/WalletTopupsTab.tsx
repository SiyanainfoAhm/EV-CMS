import { useState } from "react";
import type { PaymentOrder } from "@/types/ev";
import * as walletAdminService from "@/services/walletAdminService";

function shortId(value: string, length = 10): string {
  if (!value) return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

interface WalletTopupsTabProps {
  orders: PaymentOrder[];
  searchQuery: string;
  statusFilter: string;
  dateStart: string;
  dateEnd: string;
  formatCurrency: (n: number) => string;
  formatDateTime: (iso: string) => string;
  onSearchChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onDateStartChange: (v: string) => void;
  onDateEndChange: (v: string) => void;
}

export default function WalletTopupsTab({
  orders,
  searchQuery,
  statusFilter,
  dateStart,
  dateEnd,
  formatCurrency,
  formatDateTime,
  onSearchChange,
  onStatusChange,
  onDateStartChange,
  onDateEndChange,
}: WalletTopupsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PaymentOrder | null>(null);

  const openDetail = async (id: string) => {
    setSelectedId(id);
    const row = await walletAdminService.getPaymentOrderById(id);
    setDetail(row ?? null);
  };

  return (
    <>
      <p className="text-xs text-gray-500 px-1">
        Wallet top-ups are processed in the mobile app via Razorpay. This tab shows order history only.
      </p>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row gap-3 justify-between">
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              placeholder="Search user, order, or gateway reference..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full sm:w-72 px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm"
            />
            <select
              value={statusFilter}
              onChange={(e) => onStatusChange(e.target.value)}
              className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-xs text-gray-600"
            >
              <option value="all">All Status</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="created">Created</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <div className="flex items-center gap-1.5 px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg">
              <input
                type="date"
                value={dateStart}
                max={dateEnd}
                onChange={(e) => onDateStartChange(e.target.value)}
                className="text-xs text-gray-600 bg-transparent focus:outline-none"
                aria-label="Filter from date"
              />
              <span className="text-gray-400 text-xs">to</span>
              <input
                type="date"
                value={dateEnd}
                min={dateStart}
                onChange={(e) => onDateEndChange(e.target.value)}
                className="text-xs text-gray-600 bg-transparent focus:outline-none"
                aria-label="Filter to date"
              />
            </div>
          </div>
          <p className="text-xs text-gray-400">{orders.length} top-up orders</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                {["User", "Amount", "Gateway", "Order ref", "Payment ref", "Status", "Wallet", "Date"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className="border-b border-gray-50 hover:bg-[#f9faf7] cursor-pointer"
                  onClick={() => void openDetail(order.id)}
                >
                  <td className="px-4 py-3.5">
                    <p className="text-sm font-medium text-gray-900">{order.userName}</p>
                    <p className="text-[10px] text-gray-400">{order.userEmail}</p>
                  </td>
                  <td className="px-4 py-3.5 text-sm font-semibold">{formatCurrency(order.amount)}</td>
                  <td className="px-4 py-3.5 text-sm text-gray-600">{order.gatewayName || "—"}</td>
                  <td className="px-4 py-3.5 text-xs font-mono text-gray-500">{shortId(order.gatewayOrderId ?? "", 14)}</td>
                  <td className="px-4 py-3.5 text-xs font-mono text-gray-500">{shortId(order.gatewayPaymentId ?? "", 14)}</td>
                  <td className="px-4 py-3.5">
                    <OrderStatusPill status={order.status} />
                  </td>
                  <td className="px-4 py-3.5">
                    {order.walletCredited ? (
                      <span className="text-xs text-emerald-600 font-medium">Credited</span>
                    ) : (
                      <span className="text-xs text-gray-400">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-sm text-gray-500">{formatDateTime(order.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {orders.length === 0 && <p className="py-12 text-center text-sm text-gray-400">No wallet top-up orders found</p>}
      </div>

      {selectedId && detail && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setSelectedId(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-xl border-l border-gray-200 overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Top-up order</h3>
                  <p className="text-xs font-mono text-gray-400 mt-1">{detail.id}</p>
                </div>
                <button type="button" onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600">
                  <i className="ri-close-line text-xl"></i>
                </button>
              </div>
              <DetailRow label="User" value={`${detail.userName} (${detail.userEmail})`} />
              <DetailRow label="Amount" value={formatCurrency(detail.amount)} />
              <DetailRow label="Status" value={detail.status} />
              <DetailRow label="Gateway" value={detail.gatewayName || "—"} />
              <DetailRow label="Gateway order ref" value={detail.gatewayOrderId || "—"} mono />
              <DetailRow label="Gateway payment ref" value={detail.gatewayPaymentId || "—"} mono />
              <DetailRow label="Wallet credited" value={detail.walletCredited ? "Yes" : "No"} />
              <DetailRow label="Failure reason" value={detail.failureReason || "—"} />
              <DetailRow label="Created" value={formatDateTime(detail.createdAt)} />
              <DetailRow label="Updated" value={formatDateTime(detail.updatedAt)} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-sm text-gray-900 mt-0.5 break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}

function OrderStatusPill({ status }: { status: string }) {
  const cls =
    status === "paid"
      ? "bg-emerald-100 text-emerald-700"
      : status === "pending" || status === "created"
        ? "bg-amber-100 text-amber-700"
        : status === "failed"
          ? "bg-red-100 text-red-700"
          : "bg-gray-100 text-gray-600";
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{status}</span>;
}
