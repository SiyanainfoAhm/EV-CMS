import type { Payment } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapPayment } from "@/utils/supabaseMappers";

export async function getPayments(): Promise<Payment[]> {
  const { data, error } = await requireSupabase()
    .from("EV_Payments")
    .select("*, EV_Users ( full_name )")
    .order("created_at", { ascending: false });

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
