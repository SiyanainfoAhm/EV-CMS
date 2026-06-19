import type { User } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { normalizeRfpRole } from "@/utils/rfpRoles";
import { mapUser, mapUiRoleToDb } from "@/utils/supabaseMappers";

export interface UsersQuery {
  role?: string; // Admin | Operator | Viewer | all
  status?: string; // active | inactive | all
  search?: string; // name/email/department
  limit?: number;
}

export async function getUsers(query: UsersQuery = {}): Promise<User[]> {
  const { role = "all", status = "all", search = "", limit = 200 } = query;

  // rfid_uid is joined from EV_RFIDCards in list_ev_users (not a column on EV_Users).
  const { data, error } = await requireSupabase().rpc("list_ev_users");
  if (error) throw error;

  let rows = (data as Record<string, unknown>[]) ?? [];

  if (status !== "all") {
    rows = rows.filter((r) => r.status === status);
  }

  if (role !== "all") {
    if (role === "User") {
      rows = rows.filter((r) => normalizeRfpRole(String(r.role)) === "User");
    } else {
      rows = rows.filter((r) => r.role === mapUiRoleToDb(role));
    }
  }

  const s = search.trim().toLowerCase();
  if (s) {
    rows = rows.filter((r) => {
      const name = String(r.full_name ?? "").toLowerCase();
      const email = String(r.email ?? "").toLowerCase();
      const dept = String(r.department ?? "").toLowerCase();
      return name.includes(s) || email.includes(s) || dept.includes(s);
    });
  }

  return rows.slice(0, limit).map(mapUser);
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
  joinedDate: string;
  status: "active" | "inactive";
}

export async function createUser(input: CreateUserInput): Promise<void> {
  const { error } = await requireSupabase().rpc("create_ev_user", {
    p_email: input.email,
    p_full_name: input.name,
    p_role: mapUiRoleToDb(input.role),
    p_department: input.department,
    p_joined_date: input.joinedDate,
    p_status: input.status,
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
    p_joined_date: input.joinedDate,
    p_status: input.status,
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
