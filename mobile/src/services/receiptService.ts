import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Linking, Platform } from "react-native";
import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import type { Receipt } from "../types";

export async function getReceiptBySessionId(
  sessionId: string,
  userId?: string
): Promise<Receipt | null> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_Payments")
    .select("id, session_id, total_amount, status, created_at, EV_Receipts ( id, receipt_number, pdf_url, issued_at )")
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
    amount: Number(row.total_amount),
    issuedAt: (receipt.issued_at as string) ?? undefined,
  };
}

export async function downloadReceiptPdf(
  pdfUrl: string,
  receiptNumber: string
): Promise<string> {
  const safeName = receiptNumber.replace(/[^a-zA-Z0-9-_]/g, "_");
  const localUri = `${FileSystem.documentDirectory}receipt-${safeName}.pdf`;

  const result = await FileSystem.downloadAsync(pdfUrl, localUri);
  if (result.status !== 200) {
    throw new Error(`Download failed (${result.status})`);
  }
  return result.uri;
}

export async function shareReceiptPdf(localUri: string, receiptNumber: string): Promise<void> {
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(localUri, {
      mimeType: "application/pdf",
      dialogTitle: `Receipt ${receiptNumber}`,
      UTI: "com.adobe.pdf",
    });
    return;
  }

  if (Platform.OS === "android") {
    const contentUri = await FileSystem.getContentUriAsync(localUri);
    await Linking.openURL(contentUri);
    return;
  }

  await Linking.openURL(localUri);
}

export async function downloadAndShareReceipt(
  pdfUrl: string,
  receiptNumber: string
): Promise<void> {
  const uri = await downloadReceiptPdf(pdfUrl, receiptNumber);
  await shareReceiptPdf(uri, receiptNumber);
}
