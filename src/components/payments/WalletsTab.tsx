import { useState } from "react";
import type { WalletAccount, WalletLedgerEntry } from "@/types/ev";
import * as walletAdminService from "@/services/walletAdminService";

interface WalletsTabProps {
  accounts: WalletAccount[];
  searchQuery: string;
  statusFilter: string;
  formatCurrency: (n: number) => string;
  formatDateTime: (iso: string) => string;
  onSearchChange: (v: string) => void;
  onStatusChange: (v: string) => void;
}

export default function WalletsTab({
  accounts,
  searchQuery,
  statusFilter,
  formatCurrency,
  formatDateTime,
  onSearchChange,
  onStatusChange,
}: WalletsTabProps) {
  const [selected, setSelected] = useState<WalletAccount | null>(null);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const openWallet = async (account: WalletAccount) => {
    setSelected(account);
    setLedgerLoading(true);
    try {
      setLedger(await walletAdminService.getWalletLedgerForUser(account.userId));
    } finally {
      setLedgerLoading(false);
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row gap-3 justify-between">
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              placeholder="Search user name or email..."
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
              <option value="active">Active</option>
              <option value="blocked">Blocked</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <p className="text-xs text-gray-400">{accounts.length} wallets</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                {["User", "Balance", "Hold", "Usable", "Status", "Updated"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr
                  key={account.id}
                  className="border-b border-gray-50 hover:bg-[#f9faf7] cursor-pointer"
                  onClick={() => void openWallet(account)}
                >
                  <td className="px-4 py-3.5">
                    <p className="text-sm font-medium text-gray-900">{account.userName}</p>
                    <p className="text-[10px] text-gray-400">{account.userEmail}</p>
                  </td>
                  <td className="px-4 py-3.5 text-sm font-semibold">{formatCurrency(account.balanceAmount)}</td>
                  <td className="px-4 py-3.5 text-sm text-gray-600">{formatCurrency(account.holdAmount)}</td>
                  <td className="px-4 py-3.5 text-sm font-semibold text-emerald-700">
                    {formatCurrency(account.usableBalance)}
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        account.status === "active"
                          ? "bg-emerald-100 text-emerald-700"
                          : account.status === "blocked"
                            ? "bg-red-100 text-red-700"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {account.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-sm text-gray-500">{formatDateTime(account.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {accounts.length === 0 && <p className="py-12 text-center text-sm text-gray-400">No wallet accounts found</p>}
      </div>

      {selected && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setSelected(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-xl border-l border-gray-200 overflow-y-auto">
            <div className="p-6 space-y-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Wallet — {selected.userName}</h3>
                  <p className="text-xs text-gray-400">{selected.userEmail}</p>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">
                  <i className="ri-close-line text-xl"></i>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Stat label="Balance" value={formatCurrency(selected.balanceAmount)} />
                <Stat label="On hold" value={formatCurrency(selected.holdAmount)} />
                <Stat label="Usable" value={formatCurrency(selected.usableBalance)} accent />
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Recent ledger</h4>
                {ledgerLoading ? (
                  <p className="text-sm text-gray-400">Loading…</p>
                ) : ledger.length === 0 ? (
                  <p className="text-sm text-gray-400">No ledger entries</p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {ledger.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-gray-100 p-3 text-sm">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium capitalize">{entry.transactionType}</span>
                          <span className={entry.transactionType === "credit" ? "text-emerald-600" : "text-gray-900"}>
                            {entry.transactionType === "credit" ? "+" : "−"}
                            {formatCurrency(entry.amount)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {entry.referenceType} · {formatDateTime(entry.createdAt)}
                        </p>
                        <p className="text-[10px] text-gray-400">
                          Balance {formatCurrency(entry.balanceBefore)} → {formatCurrency(entry.balanceAfter)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-[#f5f5f3] p-3">
      <p className="text-[10px] text-gray-400 uppercase">{label}</p>
      <p className={`text-sm font-bold mt-1 ${accent ? "text-emerald-700" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}
