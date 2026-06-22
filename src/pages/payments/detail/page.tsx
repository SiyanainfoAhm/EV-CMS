import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as paymentService from "@/services/paymentService";
import type { PaymentDetail } from "@/types/ev";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import {
  buildPaymentReceiptHtml,
  downloadReceiptHtml,
  isDownloadableReceiptPdf,
  openReceiptPreview,
  resolvePaymentReceipt,
} from "@/utils/paymentReceipt";

function displayGateway(gateway: string | null, status: string): string {
  if (gateway) return gateway;
  if (status === "pending") return "—";
  return "Wallet";
}

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { formatCurrency, formatDateTime } = useUserPreferences();
  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    paymentService
      .getPaymentDetail(id)
      .then((row) => setPayment(row ?? null))
      .catch((e) => showToast(e instanceof Error ? e.message : "Failed to load payment"))
      .finally(() => setLoading(false));
  }, [id]);

  const downloadReceipt = () => {
    if (!payment || payment.status !== "success") return;
    const doc = resolvePaymentReceipt(payment);
    if (payment.receipt?.pdfUrl && isDownloadableReceiptPdf(payment.receipt.pdfUrl)) {
      window.open(payment.receipt.pdfUrl, "_blank", "noopener,noreferrer");
      showToast("Opening receipt PDF");
      return;
    }
    const html = buildPaymentReceiptHtml({
      receiptNumber: doc.receiptNumber,
      payment,
      formatCurrency,
      formatDateTime,
      issuedAt: doc.issuedAt,
    });
    downloadReceiptHtml(html, `${doc.receiptNumber}.html`);
    showToast("Receipt downloaded — open the file and use Print → Save as PDF");
  };

  const previewReceipt = () => {
    if (!payment || payment.status !== "success") return;
    const doc = resolvePaymentReceipt(payment);
    const html = buildPaymentReceiptHtml({
      receiptNumber: doc.receiptNumber,
      payment,
      formatCurrency,
      formatDateTime,
      issuedAt: doc.issuedAt,
    });
    openReceiptPreview(html);
  };

  if (loading) {
    return <p className="text-sm text-gray-500">Loading payment…</p>;
  }

  if (!payment) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500 mb-4">Payment not found</p>
        <button type="button" onClick={() => navigate("/payments")} className="text-emerald-600 text-sm font-medium">
          Back to payments
        </button>
      </div>
    );
  }

  const canDownloadReceipt = payment.status === "success";
  const receiptDoc = canDownloadReceipt ? resolvePaymentReceipt(payment) : null;

  return (
    <div className="space-y-5 max-w-3xl">
      {toast && (
        <div className="fixed top-20 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">{toast}</div>
      )}

      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/payments" className="hover:text-emerald-600">
          Payments
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Session payment</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{formatCurrency(payment.totalAmount)}</h1>
          <p className="text-sm text-gray-500 mt-1 font-mono">{payment.id}</p>
        </div>
        {canDownloadReceipt ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={downloadReceipt}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap"
            >
              Download receipt
            </button>
            <button
              type="button"
              onClick={previewReceipt}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              Preview
            </button>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-gray-500 bg-[#f9faf7] border border-gray-200 rounded-lg px-3 py-2">
        Read-only view. Payments are collected through the mobile app; this page shows billing history only.
      </p>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        <Section title="Customer">
          <Row label="Name" value={payment.userName || "—"} />
          <Row label="Email" value={payment.userEmail || "—"} />
          <Row label="User ID" value={payment.userId} mono />
        </Section>
        <Section title="Amount">
          <Row label="Base" value={formatCurrency(payment.amount)} />
          <Row label="GST" value={formatCurrency(payment.gstAmount)} />
          <Row label="Total" value={formatCurrency(payment.totalAmount)} bold />
        </Section>
        <Section title="Gateway">
          <Row label="Status" value={payment.status} />
          <Row label="Gateway" value={displayGateway(payment.gateway, payment.status)} />
          <Row
            label="Reference"
            value={payment.gatewayTxnId ?? (payment.gateway?.toLowerCase() === "wallet" || (!payment.gateway && payment.status === "success") ? "Wallet debit" : "—")}
            mono
          />
          <Row label="Reconciliation" value={payment.reconciliation || "—"} />
        </Section>
        {payment.session ? (
          <Section title="Charging session">
            <Row label="Charger" value={`${payment.session.chargerName} (${payment.session.chargePointId})`} />
            <Row label="Connector" value={String(payment.session.connectorId)} />
            <Row label="Energy" value={`${payment.session.energyKwh.toFixed(2)} kWh`} />
            <Row label="Started" value={formatDateTime(payment.session.startTime)} />
            <Row label="Ended" value={payment.session.endTime ? formatDateTime(payment.session.endTime) : "—"} />
            <Row label="Session status" value={payment.session.status} />
            <Row label="Session ID" value={payment.session.id} mono />
          </Section>
        ) : null}
        <Section title="Timestamps">
          <Row label="Created" value={formatDateTime(payment.createdAt)} />
          <Row label="Updated" value={payment.updatedAt ? formatDateTime(payment.updatedAt) : "—"} />
        </Section>
        {receiptDoc ? (
          <Section title="Receipt">
            <Row label="Receipt number" value={receiptDoc.receiptNumber} mono />
            <Row label="Issued" value={formatDateTime(receiptDoc.issuedAt)} />
            {payment.receipt?.pdfUrl && isDownloadableReceiptPdf(payment.receipt.pdfUrl) ? (
              <Row label="PDF URL" value={payment.receipt.pdfUrl} mono />
            ) : null}
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value, mono, bold }: { label: string; value: string; mono?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={`text-right break-all ${mono ? "font-mono text-xs" : ""} ${bold ? "font-semibold text-gray-900" : "text-gray-800"}`}>
        {value}
      </span>
    </div>
  );
}
