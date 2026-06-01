import type { User } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapUser, mapUiRoleToDb } from "@/utils/supabaseMappers";

export async function getUsers(): Promise<User[]> {
  const { data, error } = await requireSupabase().rpc("list_ev_users");
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map(mapUser);
}

export async function getUserById(id: string): Promise<User | undefined> {
  const users = await getUsers();
  return users.find((u) => u.id === id);
}

export interface CreateUserInput {
  name: string;
  email: string;
  role: string;
  department: string;
}

export async function createUser(input: CreateUserInput): Promise<void> {
  const { error } = await requireSupabase().rpc("create_ev_user", {
    p_email: input.email,
    p_full_name: input.name,
    p_role: mapUiRoleToDb(input.role),
    p_department: input.department,
  });
  if (error) throw error;
}

export async function updateUser(
  id: string,
  input: CreateUserInput
): Promise<void> {
  const { error } = await requireSupabase().rpc("update_ev_user", {
    p_id: id,
    p_email: input.email,
    p_full_name: input.name,
    p_role: mapUiRoleToDb(input.role),
    p_department: input.department,
  });
  if (error) throw error;
}

export async function setUserStatus(id: string, status: string): Promise<void> {
  const { error } = await requireSupabase().rpc("set_ev_user_status", {
    p_id: id,
    p_status: status,
  });
  if (error) throw error;
}

export async function deleteUser(id: string): Promise<void> {
  const { error } = await requireSupabase().rpc("delete_ev_user", { p_id: id });
  if (error) throw error;
}
