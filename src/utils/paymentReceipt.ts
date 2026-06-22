import type { PaymentDetail } from "@/types/ev";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Receipt number for payments without an EV_Receipts row. */
export function deriveReceiptNumber(paymentId: string): string {
  return `RCP-${paymentId.slice(0, 8).toUpperCase()}-${paymentId.slice(9, 13).toUpperCase()}`;
}

export function resolvePaymentReceipt(payment: PaymentDetail): { receiptNumber: string; issuedAt: string } {
  return {
    receiptNumber: payment.receipt?.receiptNumber ?? deriveReceiptNumber(payment.id),
    issuedAt: payment.receipt?.issuedAt ?? payment.updatedAt ?? payment.createdAt,
  };
}

/** Mock gateway stores placeholder PDF URLs that are not hosted files. */
export function isDownloadableReceiptPdf(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.includes("ev-cms.dfccil.gov.in/receipts/")) return false;
  return /^https?:\/\//i.test(url);
}

function displayGateway(gateway: string | null, status: string): string {
  if (gateway) return gateway;
  if (status === "pending") return "—";
  return "Wallet";
}

function paymentReference(payment: PaymentDetail): string {
  if (payment.gatewayTxnId) return payment.gatewayTxnId;
  const gw = (payment.gateway ?? "").toLowerCase();
  if (gw === "wallet" || (!payment.gateway && payment.status === "success")) return "Wallet debit";
  if (gw === "simulator") return payment.sessionId;
  return "—";
}

export interface ReceiptDocumentInput {
  receiptNumber: string;
  payment: PaymentDetail;
  issuedAt?: string;
  formatCurrency: (amount: number) => string;
  formatDateTime: (iso: string) => string;
}

export function buildPaymentReceiptHtml(input: ReceiptDocumentInput): string {
  const { receiptNumber, payment, formatCurrency, formatDateTime } = input;
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const session = payment.session;

  const rows = [
    ["Receipt number", receiptNumber],
    ["Payment ID", payment.id],
    ["Customer", payment.userName || "—"],
    ["Email", payment.userEmail || "—"],
    ["Session ID", payment.sessionId],
    ["Charger", session ? `${session.chargerName} (${session.chargePointId})` : "—"],
    ["Energy", session ? `${session.energyKwh.toFixed(2)} kWh` : "—"],
    ["Base amount", formatCurrency(payment.amount)],
    ["GST", formatCurrency(payment.gstAmount)],
    ["Total paid", formatCurrency(payment.totalAmount)],
    ["Gateway", displayGateway(payment.gateway, payment.status)],
    ["Reference", paymentReference(payment)],
    ["Status", payment.status],
    ["Issued", formatDateTime(issuedAt)],
  ];

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:13px;width:38%;">${escapeHtml(label)}</td><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:13px;font-weight:600;">${escapeHtml(value)}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Receipt ${escapeHtml(receiptNumber)}</title>
  <style>
    @media print { body { margin: 0; } .no-print { display: none; } }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f8fafc; color: #111827; margin: 0; padding: 32px; }
    .card { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; }
    .head { background: linear-gradient(135deg, #059669, #047857); color: #fff; padding: 28px 32px; }
    .body { padding: 28px 32px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .sub { opacity: 0.9; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; }
    .btn { display: inline-block; margin-bottom: 16px; padding: 10px 16px; background: #059669; color: #fff; border: 0; border-radius: 8px; cursor: pointer; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="head">
      <h1>DFCCIL EV-CMS</h1>
      <p class="sub">Charging payment receipt</p>
    </div>
    <div class="body">
      <button class="btn no-print" onclick="window.print()">Print / Save as PDF</button>
      <table>${tableRows}</table>
      <p class="footer">This is a computer-generated receipt from DFCCIL EV Charger Management System.</p>
    </div>
  </div>
</body>
</html>`;
}

export function downloadReceiptHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function openReceiptPreview(html: string): void {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
