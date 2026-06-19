import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import * as FileSystem from "expo-file-system";

export type InvoiceDetails = {
  receiptNumber: string;
  paymentId: string;
  sessionId: string;
  amount: number;
  gstAmount: number;
  totalAmount: number;
  status: string;
  issuedAt: string;
  userName: string;
  userEmail: string;
  chargerName?: string;
  chargePointId?: string;
  energyKwh?: number;
};

/** A4 in PDF points — integer sizes avoid viewer scaling quirks. */
const PAGE_W = 595;
const PAGE_H = 842;

/** Equal horizontal margins; all invoice blocks share this width. */
const MARGIN_X = 32;
const MARGIN_TOP = 28;
const CONTENT_LEFT = MARGIN_X;
const CONTENT_RIGHT = PAGE_W - MARGIN_X;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;
const INNER_PAD = 14;

const BRAND = rgb(0, 0.341, 1);
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.88, 0.88, 0.88);
const WHITE = rgb(1, 1, 1);
const HEADER_SUB = rgb(0.9, 0.95, 1);
const SESSION_BG = rgb(0.97, 0.98, 1);
const TOTAL_BG = rgb(0.94, 0.97, 1);

function pdfText(value: string): string {
  return value
    .replace(/\u202f/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\u2009/g, " ")
    .replace(/₹/g, "Rs.")
    .replace(/…/g, "...")
    .replace(/·/g, "|");
}

function formatInrForPdf(amount: number): string {
  const n = Math.round(amount * 100) / 100;
  const [intPart, decPart] = n.toFixed(2).split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `Rs. ${withCommas}.${decPart}`;
}

function formatDateForPdf(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hrs = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${months[d.getMonth()]} ${d.getFullYear()}, ${hrs}:${mins}`;
}

function textWidth(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(pdfText(text), size);
}

function truncateToWidth(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const safe = pdfText(text);
  if (textWidth(font, safe, size) <= maxWidth) return safe;
  let out = safe;
  while (out.length > 1 && textWidth(font, `${out}...`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

function drawRightText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  rightX: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>
) {
  const safe = pdfText(text);
  page.drawText(safe, { x: rightX - textWidth(font, safe, size), y, size, font, color });
}

function drawLabelValue(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  x: number,
  y: number,
  maxWidth: number,
  label: string,
  value: string,
  valueSize = 10
) {
  page.drawText(pdfText(label), { x, y, size: 8, font, color: MUTED });
  page.drawText(truncateToWidth(bold, value, valueSize, maxWidth), {
    x,
    y: y - 13,
    size: valueSize,
    font: bold,
    color: INK,
  });
}

function drawHLine(page: PDFPage, y: number) {
  page.drawLine({
    start: { x: CONTENT_LEFT, y },
    end: { x: CONTENT_RIGHT, y },
    thickness: 1,
    color: LINE,
  });
}

/** Full-width block inside content margins (header, table, boxes). */
function drawContentRect(
  page: PDFPage,
  topY: number,
  height: number,
  options: { fill?: ReturnType<typeof rgb>; border?: boolean } = {}
) {
  page.drawRectangle({
    x: CONTENT_LEFT,
    y: topY - height,
    width: CONTENT_WIDTH,
    height,
    color: options.fill ?? WHITE,
    borderColor: options.border ? LINE : undefined,
    borderWidth: options.border ? 1 : 0,
  });
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function configurePage(page: PDFPage) {
  page.setSize(PAGE_W, PAGE_H);
  page.setMediaBox(0, 0, PAGE_W, PAGE_H);
  page.setCropBox(0, 0, PAGE_W, PAGE_H);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: WHITE });
}

export async function buildInvoicePdf(details: InvoiceDetails): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  configurePage(page);

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const textRight = CONTENT_RIGHT - INNER_PAD;
  const textLeft = CONTENT_LEFT + INNER_PAD;
  const textWidthMax = CONTENT_WIDTH - INNER_PAD * 2;
  const issued = formatDateForPdf(details.issuedAt);

  let topY = PAGE_H - MARGIN_TOP;

  // Header — same width as all sections below
  const HEADER_H = 68;
  drawContentRect(page, topY, HEADER_H, { fill: BRAND });
  page.drawText("EV CMS", { x: textLeft, y: topY - 30, size: 22, font: bold, color: WHITE });
  page.drawText("Electric Vehicle Charging Management", {
    x: textLeft,
    y: topY - 48,
    size: 9,
    font: regular,
    color: HEADER_SUB,
  });
  drawRightText(page, bold, "TAX INVOICE", textRight, topY - 34, 16, WHITE);
  topY -= HEADER_H + 18;

  // Bill to | Invoice meta (two equal columns)
  const colMid = CONTENT_LEFT + CONTENT_WIDTH / 2;
  const colGap = 12;
  const leftColW = CONTENT_WIDTH / 2 - colGap;
  const rightColW = CONTENT_WIDTH / 2 - colGap;

  drawLabelValue(page, regular, bold, CONTENT_LEFT, topY, leftColW, "BILL TO", details.userName, 11);
  page.drawText(truncateToWidth(regular, details.userEmail, 9, leftColW), {
    x: CONTENT_LEFT,
    y: topY - 30,
    size: 9,
    font: regular,
    color: MUTED,
  });

  drawLabelValue(page, regular, bold, colMid + colGap, topY, rightColW, "INVOICE NO.", details.receiptNumber, 10);
  drawLabelValue(page, regular, bold, colMid + colGap, topY - 38, rightColW, "DATE", issued, 10);
  drawLabelValue(page, regular, bold, colMid + colGap, topY - 76, rightColW, "PAYMENT ID", details.paymentId, 8);
  topY -= 118;

  // Session box — full content width
  const SESSION_H = 56;
  drawContentRect(page, topY, SESSION_H, { fill: SESSION_BG, border: true });
  page.drawText(
    truncateToWidth(bold, details.chargerName ?? "Charging Session", 11, textWidthMax),
    { x: textLeft, y: topY - 22, size: 11, font: bold, color: INK }
  );
  page.drawText(
    truncateToWidth(
      regular,
      [
        details.chargePointId ? `CP: ${details.chargePointId}` : null,
        details.energyKwh != null ? `${details.energyKwh} kWh` : null,
        `Session ${details.sessionId.slice(0, 8)}`,
      ]
        .filter(Boolean)
        .join(" | "),
      9,
      textWidthMax
    ),
    { x: textLeft, y: topY - 40, size: 9, font: regular, color: MUTED }
  );
  topY -= SESSION_H + 14;

  // Line items table — full content width
  const TABLE_HEAD_H = 24;
  drawContentRect(page, topY, TABLE_HEAD_H, { fill: BRAND });
  page.drawText("DESCRIPTION", { x: textLeft, y: topY - 16, size: 8, font: bold, color: WHITE });
  drawRightText(page, bold, "AMOUNT", textRight, topY - 16, 8, WHITE);
  topY -= TABLE_HEAD_H;

  const chargingFee = details.totalAmount;

  const lineItems = [
    {
      desc: "EV charging session fee",
      sub: details.energyKwh != null ? `Energy delivered: ${details.energyKwh} kWh` : undefined,
      amount: chargingFee,
    },
  ];

  for (const item of lineItems) {
    const rowH = item.sub ? 36 : 26;
    drawContentRect(page, topY, rowH, { border: true });
    page.drawText(pdfText(item.desc), { x: textLeft, y: topY - 15, size: 10, font: regular, color: INK });
    if (item.sub) {
      page.drawText(truncateToWidth(regular, item.sub, 8, textWidthMax - 100), {
        x: textLeft,
        y: topY - rowH + 8,
        size: 8,
        font: regular,
        color: MUTED,
      });
    }
    drawRightText(page, regular, formatInrForPdf(item.amount), textRight, topY - 15, 10, INK);
    topY -= rowH;
  }

  topY -= 14;
  drawHLine(page, topY);
  topY -= 18;

  const TOTAL_H = 30;
  drawContentRect(page, topY, TOTAL_H, { fill: TOTAL_BG });
  page.drawText("TOTAL PAID", { x: textLeft, y: topY - 20, size: 10, font: bold, color: BRAND });
  drawRightText(page, bold, formatInrForPdf(chargingFee), textRight, topY - 21, 12, BRAND);
  topY -= TOTAL_H + 16;

  page.drawText(pdfText(`Payment status: ${details.status.toUpperCase()}`), {
    x: textLeft,
    y: topY,
    size: 9,
    font: bold,
    color: INK,
  });
  topY -= 24;

  drawHLine(page, topY);
  topY -= 14;

  page.drawText(
    truncateToWidth(regular, "This is a computer-generated tax invoice / receipt from EV CMS.", 8, textWidthMax),
    { x: textLeft, y: topY, size: 8, font: regular, color: MUTED }
  );
  page.drawText(
    truncateToWidth(
      regular,
      "No signature required. For support, contact your fleet administrator.",
      8,
      textWidthMax
    ),
    { x: textLeft, y: topY - 12, size: 8, font: regular, color: MUTED }
  );

  return pdf.save();
}

export async function writeInvoicePdfToFile(
  details: InvoiceDetails,
  fileUri: string
): Promise<string> {
  const bytes = await buildInvoicePdf(details);
  const base64 = uint8ToBase64(bytes);
  await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return fileUri;
}
