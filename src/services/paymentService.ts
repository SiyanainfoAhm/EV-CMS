import type { Payment } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapPayment } from "@/utils/supabaseMappers";

export interface PaymentsQuery {
  status?: string; // success | pending | failed | refunded | all
  search?: string; // id / gateway txn / user name
  limit?: number;
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
  const payments = await getPayments();
  return payments.find((p) => p.id === id);
}
