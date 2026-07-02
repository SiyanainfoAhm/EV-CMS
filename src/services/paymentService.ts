import type { Payment, PaymentDetail, PaymentReceiptInfo, PaymentSessionSummary } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { getEvUserLookup } from "@/utils/evUserLookup";
import { mapPayment } from "@/utils/supabaseMappers";
import { PAYMENT_MOCK_GATEWAY_NAME } from "@/utils/paymentMockMode";
import { isoDayEnd, isoDayStart } from "@/utils/dateRanges";

export interface PaymentsQuery {
  status?: string; // success | pending | failed | refunded | all
  search?: string; // id / gateway txn / user name
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  limit?: number;
}

export interface CreatePendingPaymentInput {
  sessionId: string;
  userId: string;
  amount: number;
  gstAmount?: number;
  totalAmount?: number;
  gateway?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getPayments(query: PaymentsQuery = {}): Promise<Payment[]> {
  const { status = "all", search = "", dateFrom, dateTo, limit = 200 } = query;
  let q = requireSupabase()
    .from("EV_Payments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status !== "all") q = q.eq("status", status);
  if (dateFrom) q = q.gte("created_at", isoDayStart(dateFrom));
  if (dateTo) q = q.lte("created_at", isoDayEnd(dateTo));

  const [{ data, error }, userLookup] = await Promise.all([q, getEvUserLookup()]);
  if (error) throw error;

  let rows = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const user = userLookup.get(r.user_id as string);
    return mapPayment(r, user ?? null);
  });
  const s = search.trim().toLowerCase();
  if (s) {
    rows = rows.filter(
      (p) =>
        p.id.toLowerCase().includes(s) ||
        (p.gatewayTxnId ?? "").toLowerCase().includes(s) ||
        (p.gateway ?? "").toLowerCase().includes(s) ||
        p.userName.toLowerCase().includes(s) ||
        (p.userEmail ?? "").toLowerCase().includes(s) ||
        p.sessionId.toLowerCase().includes(s)
    );
  }

  return rows;
}

export async function getPaymentById(id: string): Promise<Payment | undefined> {
  const [{ data, error }, userLookup] = await Promise.all([
    requireSupabase().from("EV_Payments").select("*").eq("id", id).maybeSingle(),
    getEvUserLookup(),
  ]);

  if (error) throw error;
  if (!data) return undefined;
  const r = data as Record<string, unknown>;
  const user = userLookup.get(r.user_id as string);
  return mapPayment(r, user ?? null);
}
export async function getPaymentDetail(id: string): Promise<PaymentDetail | undefined> {
  const payment = await getPaymentById(id);
  if (!payment) return undefined;

  const [{ data: sessionData }, receipt] = await Promise.all([
    requireSupabase()
      .from("EV_ChargingSessions")
      .select("id, energy_kwh, start_time, end_time, status, connector_id, EV_Chargers!left ( name, charge_point_id )")
      .eq("id", payment.sessionId)
      .maybeSingle(),
    getReceiptForPayment(id),
  ]);

  let session: PaymentSessionSummary | undefined;
  if (sessionData) {
    const s = sessionData as Record<string, unknown>;
    const charger = s.EV_Chargers as Record<string, unknown> | null;
    session = {
      id: s.id as string,
      chargerName: (charger?.name as string) ?? "—",
      chargePointId: (charger?.charge_point_id as string) ?? "—",
      connectorId: Number(s.connector_id ?? 0),
      energyKwh: Number(s.energy_kwh ?? 0),
      startTime: s.start_time as string,
      endTime: (s.end_time as string) ?? null,
      status: s.status as string,
    };
  }

  const receiptInfo: PaymentReceiptInfo | undefined = receipt
    ? { receiptNumber: receipt.receiptNumber, pdfUrl: receipt.pdfUrl, issuedAt: receipt.issuedAt }
    : undefined;

  return { ...payment, session, receipt: receiptInfo };
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
  const gstAmount =
    input.gstAmount != null
      ? round2(input.gstAmount)
      : 0;
  const totalAmount = round2(input.totalAmount ?? amount + gstAmount);

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

export async function getReceiptForPayment(
  paymentId: string
): Promise<{ receiptNumber: string; pdfUrl: string | null; issuedAt: string } | null> {
  const { data, error } = await requireSupabase()
    .from("EV_Receipts")
    .select("receipt_number, pdf_url, issued_at")
    .eq("payment_id", paymentId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const row = data as { receipt_number: string; pdf_url: string | null; issued_at: string };
  return { receiptNumber: row.receipt_number, pdfUrl: row.pdf_url, issuedAt: row.issued_at };
}

export async function upsertReceiptFromGateway(
  paymentId: string,
  receiptNumber: string,
  pdfUrl?: string | null
): Promise<{ receiptNumber: string; pdfUrl?: string }> {
  const existing = await getReceiptForPayment(paymentId);
  if (existing) {
    return { receiptNumber: existing.receiptNumber, pdfUrl: existing.pdfUrl ?? undefined };
  }

  const { error } = await requireSupabase().from("EV_Receipts").insert({
    payment_id: paymentId,
    receipt_number: receiptNumber,
    pdf_url: pdfUrl ?? null,
  });

  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Cannot create receipt: run supabase/payments_admin.sql in Supabase."
        : error.message
    );
  }

  return { receiptNumber, pdfUrl: pdfUrl ?? undefined };
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
