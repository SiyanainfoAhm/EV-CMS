import { requireSupabase } from "../utils/supabaseClient";
import type { Payment } from "../types";

export async function getPaymentHistory(): Promise<Payment[]> {
  const { data, error } = await requireSupabase()
    .from("EV_Payments")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    sessionId: row.session_id as string,
    totalAmount: Number(row.total_amount),
    status: row.status as string,
    createdAt: row.created_at as string,
  }));
}
