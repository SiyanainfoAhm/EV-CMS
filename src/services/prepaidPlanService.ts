import type { PrepaidMode, PrepaidPlan } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";

function mapPlan(row: Record<string, unknown>): PrepaidPlan {
  return {
    id: row.id as string,
    mode: row.mode as PrepaidMode,
    value: Number(row.value),
    label: row.label as string,
    sortOrder: Number(row.sort_order ?? 0),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string) ?? undefined,
  };
}

export interface PrepaidPlanInput {
  mode: PrepaidMode;
  value: number;
  label: string;
  sortOrder?: number;
  isActive?: boolean;
}

export async function getPrepaidPlans(): Promise<PrepaidPlan[]> {
  const { data, error } = await requireSupabase()
    .from("EV_PrepaidPlans")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("mode", { ascending: true });

  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map(mapPlan);
}

export async function getActivePrepaidPlans(): Promise<PrepaidPlan[]> {
  const plans = await getPrepaidPlans();
  return plans.filter((p) => p.isActive);
}

export async function createPrepaidPlan(input: PrepaidPlanInput): Promise<PrepaidPlan> {
  const { data, error } = await requireSupabase()
    .from("EV_PrepaidPlans")
    .insert({
      mode: input.mode,
      value: input.value,
      label: input.label.trim(),
      sort_order: input.sortOrder ?? 100,
      is_active: input.isActive ?? true,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Cannot create prepaid plan — run supabase/prepaid_billing.sql"
        : error.message
    );
  }
  return mapPlan(data as Record<string, unknown>);
}

export async function updatePrepaidPlan(id: string, input: PrepaidPlanInput): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_PrepaidPlans")
    .update({
      mode: input.mode,
      value: input.value,
      label: input.label.trim(),
      sort_order: input.sortOrder ?? 100,
      is_active: input.isActive ?? true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function togglePrepaidPlanActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_PrepaidPlans")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function deletePrepaidPlan(id: string): Promise<void> {
  const { error } = await requireSupabase().from("EV_PrepaidPlans").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export function formatPrepaidPlanValue(plan: Pick<PrepaidPlan, "mode" | "value">): string {
  if (plan.mode === "amount") return `₹${Number(plan.value).toFixed(plan.value % 1 === 0 ? 0 : 2)}`;
  const mins = Number(plan.value);
  if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
  return `${mins} min`;
}
