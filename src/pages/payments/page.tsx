import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import * as paymentService from "@/services/paymentService";
import * as walletAdminService from "@/services/walletAdminService";
import type { Payment } from "@/types/ev";
import type { PaymentOrder, WalletAccount } from "@/types/ev";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import SessionPaymentsTab from "@/components/payments/SessionPaymentsTab";
import WalletTopupsTab from "@/components/payments/WalletTopupsTab";
import WalletsTab from "@/components/payments/WalletsTab";

type PaymentsTab = "sessions" | "topups" | "wallets";

export default function PaymentsPage() {
  const { formatCurrency, formatDateTime } = useUserPreferences();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as PaymentsTab) || "sessions";
  const initialSearch = searchParams.get("search") ?? "";

  const [payments, setPayments] = useState<Payment[]>([]);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [wallets, setWallets] = useState<WalletAccount[]>([]);
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [toast, setToast] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const setTab = (tab: PaymentsTab) => {
    setSearchParams({ tab });
    setSearchQuery("");
    setStatusFilter("all");
  };

  const loadSessionPayments = useCallback(() => {
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

  const loadTopups = useCallback(() => {
    walletAdminService
      .getPaymentOrders({ status: statusFilter, search: debouncedSearch })
      .then(setOrders)
      .catch((e) => showToast(e instanceof Error ? e.message : "Failed to load top-up orders"));
  }, [statusFilter, debouncedSearch]);

  const loadWallets = useCallback(() => {
    walletAdminService
      .getWalletAccounts({ status: statusFilter, search: debouncedSearch })
      .then(setWallets)
      .catch((e) => showToast(e instanceof Error ? e.message : "Failed to load wallets"));
  }, [statusFilter, debouncedSearch]);

  useEffect(() => {
    if (activeTab === "sessions") loadSessionPayments();
    else if (activeTab === "topups") loadTopups();
    else loadWallets();
  }, [activeTab, loadSessionPayments, loadTopups, loadWallets]);

  useEffect(() => {
    const q = searchParams.get("search");
    if (q && activeTab === "wallets") setSearchQuery(q);
  }, [searchParams, activeTab]);

  const sessionStats = useMemo(() => {
    const success = payments.filter((p) => p.status === "success");
    return {
      totalTransactions: payments.length,
      successfulPayments: success.length,
      pendingPayments: payments.filter((p) => p.status === "pending").length,
      totalRevenue: success.reduce((sum, p) => sum + p.totalAmount, 0),
    };
  }, [payments]);

  const topupStats = useMemo(() => {
    const paid = orders.filter((o) => o.status === "paid");
    return {
      total: orders.length,
      paid: paid.length,
      pending: orders.filter((o) => o.status === "pending" || o.status === "created").length,
      volume: paid.reduce((s, o) => s + o.amount, 0),
    };
  }, [orders]);

  const walletStats = useMemo(() => {
    const active = wallets.filter((w) => w.status === "active");
    return {
      total: wallets.length,
      active: active.length,
      totalBalance: active.reduce((s, w) => s + w.balanceAmount, 0),
      usable: active.reduce((s, w) => s + w.usableBalance, 0),
    };
  }, [wallets]);

  return (
    <div className="space-y-5 min-w-0 max-w-full">
      {toast && (
        <div className="fixed top-20 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-sm">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Payments &amp; Wallets
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Read-only history and wallet balances. Top-ups and payments are processed in the mobile app.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-[#f9faf7] px-4 py-3">
        <i className="ri-information-line text-gray-500 text-lg mt-0.5"></i>
        <p className="text-xs text-gray-600">
          This admin view does not process payments. Wallet top-ups use Razorpay on mobile only; use the tabs below to review
          session billing, top-up orders, and per-user wallet balances.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "sessions" as const, label: "Session payments", icon: "ri-bank-card-line" },
            { id: "topups" as const, label: "Wallet top-ups", icon: "ri-wallet-3-line" },
            { id: "wallets" as const, label: "User wallets", icon: "ri-account-box-line" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTab(tab.id)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-emerald-600 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <i className={tab.icon}></i>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "sessions" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Transactions" value={String(sessionStats.totalTransactions)} />
            <StatCard label="Successful" value={String(sessionStats.successfulPayments)} accent="emerald" />
            <StatCard label="Pending" value={String(sessionStats.pendingPayments)} accent="amber" />
            <StatCard label="Revenue" value={formatCurrency(sessionStats.totalRevenue)} accent="rose" />
          </div>
          <SessionPaymentsTab
            payments={payments}
            receipts={receipts}
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            formatCurrency={formatCurrency}
            formatDateTime={formatDateTime}
            onSearchChange={setSearchQuery}
            onStatusChange={setStatusFilter}
          />
        </>
      )}

      {activeTab === "topups" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Orders" value={String(topupStats.total)} />
            <StatCard label="Paid" value={String(topupStats.paid)} accent="emerald" />
            <StatCard label="Pending" value={String(topupStats.pending)} accent="amber" />
            <StatCard label="Top-up volume" value={formatCurrency(topupStats.volume)} accent="rose" />
          </div>
          <WalletTopupsTab
            orders={orders}
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            formatCurrency={formatCurrency}
            formatDateTime={formatDateTime}
            onSearchChange={setSearchQuery}
            onStatusChange={setStatusFilter}
          />
        </>
      )}

      {activeTab === "wallets" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Wallets" value={String(walletStats.total)} />
            <StatCard label="Active" value={String(walletStats.active)} accent="emerald" />
            <StatCard label="Total balance" value={formatCurrency(walletStats.totalBalance)} />
            <StatCard label="Usable" value={formatCurrency(walletStats.usable)} accent="rose" />
          </div>
          <WalletsTab
            accounts={wallets}
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            formatCurrency={formatCurrency}
            formatDateTime={formatDateTime}
            onSearchChange={setSearchQuery}
            onStatusChange={setStatusFilter}
          />
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: "emerald" | "amber" | "rose" }) {
  const color =
    accent === "emerald" ? "text-emerald-600" : accent === "amber" ? "text-amber-600" : accent === "rose" ? "text-rose-600" : "text-gray-900";
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-0">
      <p className="text-xs text-gray-500 mb-1 truncate">{label}</p>
      <p className={`text-2xl font-bold truncate ${color}`}>{value}</p>
    </div>
  );
}
