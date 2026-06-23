import { useNavigate } from "react-router-dom";
import type { Payment } from "@/types/ev";

function shortId(value: string, length = 8): string {
  if (!value) return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function displayGateway(gateway: string | null, status: string): string {
  if (gateway) return gateway;
  if (status === "pending") return "—";
  return "Wallet";
}

function paymentReference(payment: Payment): string {
  if (payment.gatewayTxnId) return shortId(payment.gatewayTxnId, 14);
  const gw = (payment.gateway ?? "").toLowerCase();
  if (gw === "wallet" || (!payment.gateway && payment.status === "success")) return "Wallet debit";
  if (gw === "simulator") return `Session ${shortId(payment.sessionId, 8)}`;
  return payment.status === "success" ? shortId(payment.id, 10) : "—";
}

interface SessionPaymentsTabProps {
  payments: Payment[];
  receipts: Record<string, string>;
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

/** Read-only session payment history (payments happen on mobile / simulator). */
export default function SessionPaymentsTab({
  payments,
  receipts,
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
}: SessionPaymentsTabProps) {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-xl border border-gray-200 min-w-0 max-w-full overflow-hidden">
      <div className="p-4 border-b border-gray-200">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none min-w-0">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
              <input
                type="text"
                placeholder="Search user, session, or transaction ID..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full sm:w-72 pl-9 pr-4 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => onStatusChange(e.target.value)}
              className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="all">All Status</option>
              <option value="success">Success</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
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
          <p className="text-xs text-gray-400 shrink-0">{payments.length} records</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] table-fixed">
          <thead>
            <tr className="border-b border-gray-100">
              {["User", "Session", "Amount", "Gateway", "Reference", "Status", "Recon", "Date"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr
                key={payment.id}
                className="border-b border-gray-50 hover:bg-[#f9faf7] transition-colors cursor-pointer"
                onClick={() => navigate(`/payments/${payment.id}`)}
              >
                <td className="px-4 py-3.5 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{payment.userName || "—"}</p>
                  <p className="text-[10px] text-gray-400 truncate">
                    {payment.userEmail || shortId(payment.userId, 12)}
                  </p>
                </td>
                <td className="px-4 py-3.5">
                  <span className="text-xs font-mono text-gray-500">{shortId(payment.sessionId, 10)}</span>
                </td>
                <td className="px-4 py-3.5">
                  <p className="text-sm font-semibold text-gray-900">{formatCurrency(payment.totalAmount)}</p>
                  <p className="text-[10px] text-gray-400">
                    {formatCurrency(payment.amount)} + GST {formatCurrency(payment.gstAmount)}
                  </p>
                </td>
                <td className="px-4 py-3.5 text-sm text-gray-600 truncate">
                  {displayGateway(payment.gateway, payment.status)}
                </td>
                <td className="px-4 py-3.5 text-xs font-mono text-gray-400 truncate" title={payment.gatewayTxnId ?? undefined}>
                  {paymentReference(payment)}
                </td>
                <td className="px-4 py-3.5">
                  <StatusPill value={payment.status} />
                </td>
                <td className="px-4 py-3.5">
                  <StatusPill value={payment.reconciliation || "—"} matched={payment.reconciliation === "matched"} />
                </td>
                <td className="px-4 py-3.5">
                  <p className="text-sm text-gray-500 whitespace-nowrap">{formatDateTime(payment.createdAt)}</p>
                  {receipts[payment.id] ? (
                    <p className="text-[10px] text-emerald-600 truncate">{receipts[payment.id]}</p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {payments.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">No session payments found</p>
        </div>
      )}
    </div>
  );
}

function StatusPill({ value, matched }: { value: string; matched?: boolean }) {
  const cls =
    value === "success" || matched
      ? "bg-emerald-100 text-emerald-700"
      : value === "pending" || value === "unmatched"
        ? "bg-amber-100 text-amber-700"
        : value === "failed"
          ? "bg-red-100 text-red-700"
          : "bg-gray-100 text-gray-600";
  return <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>{value}</span>;
}
