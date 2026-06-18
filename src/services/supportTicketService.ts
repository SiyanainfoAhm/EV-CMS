import type { SupportTicket } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapSupportTicket } from "@/utils/supabaseMappers";

const TICKET_SELECT =
  "*, requester:EV_Users!EV_SupportTickets_user_id_fkey ( full_name, email ), assignee:EV_Users!EV_SupportTickets_assigned_to_fkey ( full_name )";

export interface SupportTicketsQuery {
  status?: string;
  priority?: string;
  search?: string;
  limit?: number;
}

export interface UpdateSupportTicketInput {
  status?: string;
  priority?: string;
  assignedTo?: string | null;
}

function mapRow(row: Record<string, unknown>): SupportTicket {
  return mapSupportTicket(
    row,
    row.requester as Record<string, unknown> | null,
    row.assignee as Record<string, unknown> | null
  );
}

export async function getSupportTickets(query: SupportTicketsQuery = {}): Promise<SupportTicket[]> {
  const { status = "all", priority = "all", search = "", limit = 200 } = query;

  let q = requireSupabase()
    .from("EV_SupportTickets")
    .select(TICKET_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status !== "all") q = q.eq("status", status);
  if (priority !== "all") q = q.eq("priority", priority);

  const s = search.trim();
  if (s) {
    q = q.or(`subject.ilike.%${s}%,description.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw error;

  let tickets = (data ?? []).map((row) => mapRow(row as Record<string, unknown>));

  if (s) {
    const lower = s.toLowerCase();
    tickets = tickets.filter(
      (t) =>
        t.subject.toLowerCase().includes(lower) ||
        t.description.toLowerCase().includes(lower) ||
        t.userName.toLowerCase().includes(lower) ||
        t.userEmail.toLowerCase().includes(lower)
    );
  }

  return tickets;
}

export async function getSupportTicketById(id: string): Promise<SupportTicket | null> {
  const { data, error } = await requireSupabase()
    .from("EV_SupportTickets")
    .select(TICKET_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function updateSupportTicket(id: string, input: UpdateSupportTicketInput): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.status !== undefined) patch.status = input.status;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.assignedTo !== undefined) patch.assigned_to = input.assignedTo;

  const { error } = await requireSupabase().from("EV_SupportTickets").update(patch).eq("id", id);

  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Cannot update ticket: run supabase/support_tickets_admin.sql in Supabase."
        : error.message
    );
  }
}
