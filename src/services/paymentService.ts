import type { Payment } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapPayment } from "@/utils/supabaseMappers";
import { PAYMENT_MOCK_GATEWAY_NAME } from "@/utils/paymentMockMode";

export interface PaymentsQuery {
  status?: string; // success | pending | failed | refunded | all
  search?: string; // id / gateway txn / user name
  limit?: number;
}

export interface CreatePendingPaymentInput {
  sessionId: string;
  userId: string;
  amount: number;
  gstAmount?: number;
  gateway?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getPayments(query: PaymentsQuery = {}): Promise<Payment[]> {
  const { status = "all", search = "", limit = 200 } = query;
  let q = requireSupabase()
    .from("EV_Payments")
    .select("*, EV_Users!left ( full_name )")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status !== "all") q = q.eq("status", status);

  const s = search.trim();
  if (s) {
    // Supabase OR supports simple columns; keep it robust across environments.
    q = q.or(`id.ilike.%${s}%,gateway_txn_id.ilike.%${s}%,gateway.ilike.%${s}%`);
  }

  const { data, error } = await q;

  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return mapPayment(r, r.EV_Users as Record<string, unknown> | null);
  });
}

export async function getPaymentById(id: string): Promise<Payment | undefined> {
  const { data, error } = await requireSupabase()
    .from("EV_Payments")
    .select("*, EV_Users!left ( full_name )")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return undefined;
  const r = data as Record<string, unknown>;
  return mapPayment(r, r.EV_Users as Record<string, unknown> | null);
}

export async function paymentExistsForSession(sessionId: string): Promise<boolean> {
  const { data, error } = await requireSupabase()
    .from("EV_Payments")
    .select("id")
    .eq("session_id", sessionId)
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function createPendingPayment(input: CreatePendingPaymentInput): Promise<string> {
  const exists = await paymentExistsForSession(input.sessionId);
  if (exists) throw new Error("A payment record already exists for this session");

  const amount = round2(input.amount);
  const gstAmount = round2(input.gstAmount ?? amount * 0.18);
  const totalAmount = round2(amount + gstAmount);

  const { data, error } = await requireSupabase()
    .from("EV_Payments")
    .insert({
      session_id: input.sessionId,
      user_id: input.userId,
      amount,
      gst_amount: gstAmount,
      total_amount: totalAmount,
      status: "pending",
      gateway: input.gateway ?? PAYMENT_MOCK_GATEWAY_NAME,
      reconciliation_status: "unmatched",
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Cannot create payment: run supabase/payments_admin.sql and charger_simulator.sql on Supabase."
        : error.message
    );
  }

  return (data as { id: string }).id;
}

export async function markPaymentVerified(paymentId: string, gatewayTxnId: string, gateway?: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_Payments")
    .update({
      status: "success",
      gateway_txn_id: gatewayTxnId,
      gateway: gateway ?? PAYMENT_MOCK_GATEWAY_NAME,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId);

  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Cannot update payment: run supabase/payments_admin.sql in Supabase."
        : error.message
    );
  }
}

export async function markPaymentFailed(paymentId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_Payments")
    .update({
      status: "failed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId);

  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Cannot update payment: run supabase/payments_admin.sql in Supabase."
        : error.message
    );
  }
}

export async function markPaymentReconciled(paymentId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_Payments")
    .update({
      reconciliation_status: "matched",
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId);

  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Cannot reconcile payment: run supabase/payments_admin.sql in Supabase."
        : error.message
    );
  }
}

export async function getReceiptForPayment(paymentId: string): Promise<{ receiptNumber: string; pdfUrl: string | null } | null> {
  const { data, error } = await requireSupabase()
    .from("EV_Receipts")
    .select("receipt_number, pdf_url")
    .eq("payment_id", paymentId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const row = data as { receipt_number: string; pdf_url: string | null };
  return { receiptNumber: row.receipt_number, pdfUrl: row.pdf_url };
}

export async function createReceiptForPayment(paymentId: string): Promise<{ receiptNumber: string; pdfUrl?: string }> {
  const existing = await getReceiptForPayment(paymentId);
  if (existing) {
    return { receiptNumber: existing.receiptNumber, pdfUrl: existing.pdfUrl ?? undefined };
  }

  const payment = await getPaymentById(paymentId);
  if (!payment) throw new Error("Payment not found");
  if (payment.status !== "success") throw new Error("Receipt can only be generated for successful payments");

  const receiptNumber = `RCP-${paymentId.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const pdfUrl = `https://ev-cms.dfccil.gov.in/receipts/${receiptNumber}.pdf`;

  const { error } = await requireSupabase().from("EV_Receipts").insert({
    payment_id: paymentId,
    receipt_number: receiptNumber,
    pdf_url: pdfUrl,
  });

  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Cannot create receipt: run supabase/payments_admin.sql in Supabase."
        : error.message
    );
  }

  return { receiptNumber, pdfUrl };
}
