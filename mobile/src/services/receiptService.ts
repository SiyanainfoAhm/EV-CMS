import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { requireSupabase } from "../utils/supabaseClient";
import { getSessionUser, requireUserId } from "./authService";
import { writeInvoicePdfToFile, type InvoiceDetails } from "./receiptPdf";
import type { Receipt } from "../types";

const UNREACHABLE_RECEIPT_HOSTS = new Set(["ev-cms.dfccil.gov.in"]);

export type ReceiptActionInput = {
  paymentId: string;
  receiptNumber: string;
  pdfUrl?: string | null;
};

type ReceiptFile = {
  uri: string;
  mimeType: string;
};

type ReceiptPdfDetails = InvoiceDetails;

function exportFilename(receiptNumber: string): string {
  return `EV-CMS-${receiptNumber.replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`;
}

function localReceiptPath(receiptNumber: string): string {
  return `${FileSystem.documentDirectory}${exportFilename(receiptNumber)}`;
}

function shouldGenerateLocalReceipt(pdfUrl: string | null | undefined): boolean {
  if (!pdfUrl?.trim()) return true;
  try {
    const host = new URL(pdfUrl).hostname.toLowerCase();
    if (UNREACHABLE_RECEIPT_HOSTS.has(host)) return true;
    if (host.includes("localhost") || host.endsWith(".local")) return true;
  } catch {
    return true;
  }
  return false;
}

async function getReceiptPdfDetails(paymentId: string): Promise<ReceiptPdfDetails> {
  const uid = requireUserId();
  const user = getSessionUser();

  const { data, error } = await requireSupabase()
    .from("EV_Payments")
    .select(
      "id, session_id, amount, gst_amount, total_amount, status, created_at, EV_Receipts ( receipt_number, issued_at ), EV_ChargingSessions ( energy_kwh, EV_Chargers ( name, charge_point_id ) )"
    )
    .eq("id", paymentId)
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("RECEIPT_NOT_FOUND");

  const row = data as Record<string, unknown>;
  const receipts = (row.EV_Receipts as Record<string, unknown>[] | Record<string, unknown> | null) ?? [];
  const receipt = Array.isArray(receipts) ? receipts[0] : receipts;
  const sessions = (row.EV_ChargingSessions as Record<string, unknown>[] | Record<string, unknown> | null) ?? [];
  const session = Array.isArray(sessions) ? sessions[0] : sessions;
  const chargers = session?.EV_Chargers as Record<string, unknown>[] | Record<string, unknown> | undefined;
  const charger = Array.isArray(chargers) ? chargers[0] : chargers;

  return {
    receiptNumber: String(receipt?.receipt_number ?? `RCP-${paymentId.slice(0, 8)}`),
    paymentId,
    sessionId: row.session_id as string,
    amount: Number(row.amount),
    gstAmount: Number(row.gst_amount ?? 0),
    totalAmount: Number(row.total_amount ?? row.amount),
    status: String(row.status),
    issuedAt: String(receipt?.issued_at ?? row.created_at),
    userName: user?.name ?? "EV CMS User",
    userEmail: user?.email ?? "",
    chargerName: charger?.name ? String(charger.name) : undefined,
    chargePointId: charger?.charge_point_id ? String(charger.charge_point_id) : undefined,
    energyKwh: session?.energy_kwh != null ? Number(session.energy_kwh) : undefined,
  };
}

async function generateLocalReceiptFile(
  paymentId: string,
  receiptNumber: string
): Promise<ReceiptFile> {
  const details = await getReceiptPdfDetails(paymentId);
  const uri = localReceiptPath(receiptNumber);
  await FileSystem.deleteAsync(uri, { idempotent: true });
  await writeInvoicePdfToFile({ ...details, receiptNumber }, uri);
  return { uri, mimeType: "application/pdf" };
}

async function downloadRemoteReceiptPdf(pdfUrl: string, receiptNumber: string): Promise<ReceiptFile> {
  const uri = localReceiptPath(receiptNumber);
  await FileSystem.deleteAsync(uri, { idempotent: true });
  const result = await FileSystem.downloadAsync(pdfUrl, uri);
  if (result.status !== 200) {
    throw new Error(`Download failed (${result.status})`);
  }
  return { uri: result.uri, mimeType: "application/pdf" };
}

export async function ensureReceiptFile(input: ReceiptActionInput): Promise<ReceiptFile> {
  const { paymentId, receiptNumber, pdfUrl } = input;

  if (pdfUrl && !shouldGenerateLocalReceipt(pdfUrl)) {
    try {
      return await downloadRemoteReceiptPdf(pdfUrl, receiptNumber);
    } catch {
      // Fall back to on-device receipt when remote host is unreachable.
    }
  }

  return generateLocalReceiptFile(paymentId, receiptNumber);
}

/** Copy PDF to cache with a clean filename — improves Android viewer/share compatibility. */
async function prepareExportFile(sourceUri: string, receiptNumber: string): Promise<string> {
  const dest = `${FileSystem.cacheDirectory}${exportFilename(receiptNumber)}`;
  await FileSystem.deleteAsync(dest, { idempotent: true });
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}

async function sharePdfFile(fileUri: string, dialogTitle: string): Promise<void> {
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error("SHARE_UNAVAILABLE");

  await Sharing.shareAsync(fileUri, {
    mimeType: "application/pdf",
    dialogTitle,
    UTI: "com.adobe.pdf",
  });
}

/** Save PDF to a user-selected folder (e.g. Downloads) via Storage Access Framework. */
async function savePdfToFolder(fileUri: string, receiptNumber: string): Promise<boolean> {
  try {
    const { StorageAccessFramework } = FileSystem;
    const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perm.granted) return false;

    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const destUri = await StorageAccessFramework.createFileAsync(
      perm.directoryUri,
      exportFilename(receiptNumber),
      "application/pdf"
    );
    await FileSystem.writeAsStringAsync(destUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return true;
  } catch {
    return false;
  }
}

export async function getReceiptBySessionId(
  sessionId: string,
  userId?: string
): Promise<Receipt | null> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_Payments")
    .select("id, session_id, amount, status, created_at, EV_Receipts ( id, receipt_number, pdf_url, issued_at )")
    .eq("user_id", uid)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const receipts = (row.EV_Receipts as Record<string, unknown>[]) ?? [];
  const receipt = receipts[0];
  if (!receipt) return null;

  return {
    id: receipt.id as string,
    paymentId: row.id as string,
    sessionId: row.session_id as string,
    receiptNumber: receipt.receipt_number as string,
    pdfUrl: (receipt.pdf_url as string) ?? null,
    amount: Number(row.amount),
    issuedAt: (receipt.issued_at as string) ?? undefined,
  };
}

export async function downloadReceipt(input: ReceiptActionInput): Promise<void> {
  const file = await ensureReceiptFile(input);
  const exportUri = await prepareExportFile(file.uri, input.receiptNumber);

  const saved = await savePdfToFolder(exportUri, input.receiptNumber);
  if (saved) return;

  // No native IntentLauncher — open/save via share sheet (grants URI read permission).
  await sharePdfFile(exportUri, `Open or save receipt ${input.receiptNumber}`);
}

export async function shareReceipt(input: ReceiptActionInput): Promise<void> {
  const file = await ensureReceiptFile(input);
  const exportUri = await prepareExportFile(file.uri, input.receiptNumber);
  await sharePdfFile(exportUri, `Share receipt ${input.receiptNumber}`);
}

/** @deprecated Use downloadReceipt or shareReceipt */
export async function downloadReceiptPdf(pdfUrl: string, receiptNumber: string): Promise<string> {
  const file = await downloadRemoteReceiptPdf(pdfUrl, receiptNumber);
  return file.uri;
}

/** @deprecated Use shareReceipt */
export async function downloadAndShareReceipt(
  pdfUrl: string,
  receiptNumber: string
): Promise<void> {
  await shareReceipt({ paymentId: "", receiptNumber, pdfUrl });
}
