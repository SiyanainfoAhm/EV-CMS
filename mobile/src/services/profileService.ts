import { requireSupabase } from "../utils/supabaseClient";
import type { User } from "../types";

function mapProfileRow(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    name: row.full_name as string,
    email: row.email as string,
    role: row.role as string,
    phone: (row.phone as string) ?? undefined,
    department: (row.department as string) ?? undefined,
    avatarUrl: (row.avatar_url as string) ?? null,
  };
}

export async function getProfile(userId: string): Promise<User> {
  const { data, error } = await requireSupabase().rpc("get_ev_user_profile", { p_user_id: userId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Profile not found");
  return mapProfileRow(row as Record<string, unknown>);
}

export async function updateProfile(
  userId: string,
  input: { name: string; email: string; phone?: string; department?: string; avatarUrl?: string | null }
): Promise<void> {
  const { error } = await requireSupabase().rpc("update_ev_user_profile", {
    p_user_id: userId,
    p_full_name: input.name.trim(),
    p_email: input.email.trim(),
    p_phone: input.phone?.trim() ?? null,
    p_department: input.department?.trim() ?? null,
    p_avatar_url: input.avatarUrl ?? null,
  });
  if (error) throw error;
}
