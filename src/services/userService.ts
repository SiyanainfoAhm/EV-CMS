import type { User } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapUser, mapUiRoleToDb } from "@/utils/supabaseMappers";

export interface UsersQuery {
  role?: string; // Admin | Operator | Viewer | all
  status?: string; // active | inactive | all
  search?: string; // name/email/department
  limit?: number;
}

export async function getUsers(query: UsersQuery = {}): Promise<User[]> {
  const { role = "all", status = "all", search = "", limit = 200 } = query;

  // Prefer direct table query for dynamic filtering.
  // (RPC `list_ev_users` can't accept filter params in the current schema.)
  let q = requireSupabase()
    .from("EV_Users")
    .select(
      "id, full_name, email, role, department, status, last_login_at, created_at, phone, employee_id, avatar_url, rfid_uid"
    )
    .order("full_name")
    .limit(limit);

  if (status !== "all") q = q.eq("status", status);

  if (role !== "all") {
    if (role === "User") {
      q = q.in("role", ["Operator", "Viewer"]);
    } else {
      q = q.eq("role", mapUiRoleToDb(role));
    }
  }

  const s = search.trim();
  if (s) {
    q = q.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,department.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map(mapUser);
}

export async function getUserById(id: string): Promise<User | undefined> {
  const users = await getUsers({ search: "", limit: 1000 });
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
