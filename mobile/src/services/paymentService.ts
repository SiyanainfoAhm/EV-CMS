import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import type { Payment } from "../types";

export async function getPaymentHistory(userId?: string): Promise<Payment[]> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_Payments")
    .select("*, EV_Receipts ( id, receipt_number, pdf_url, issued_at )")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const receipts = (r.EV_Receipts as Record<string, unknown>[]) ?? [];
    const receipt = receipts[0];
    return {
      id: r.id as string,
      sessionId: r.session_id as string,
      totalAmount: Number(r.total_amount),
      status: r.status as string,
      createdAt: r.created_at as string,
      receiptNumber: receipt ? (receipt.receipt_number as string) : undefined,
      receiptPdfUrl: receipt?.pdf_url ? (receipt.pdf_url as string) : undefined,
    };
  });
}
