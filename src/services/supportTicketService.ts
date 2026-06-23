import type { SupportTicket, SupportTicketAttachment } from "@/types/ev";
import * as mediaService from "@/services/mediaService";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapSupportTicket } from "@/utils/supabaseMappers";
import { MAX_SUPPORT_TICKET_ATTACHMENTS } from "@/utils/supportTicketAttachments";
import { isoDayEnd, isoDayStart } from "@/utils/dateRanges";

const TICKET_SELECT =
  "*, requester:EV_Users!EV_SupportTickets_user_id_fkey ( full_name, email ), assignee:EV_Users!EV_SupportTickets_assigned_to_fkey ( full_name )";

export interface SupportTicketsQuery {
  status?: string;
  priority?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
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

async function hydrateAttachmentsFromStorage(ticket: SupportTicket): Promise<SupportTicket> {
  if (ticket.attachments.length > 0) return ticket;
  try {
    const fromStorage = await mediaService.listSupportTicketAttachments(ticket.userId, ticket.id);
    if (fromStorage.length > 0) {
      await saveTicketAttachments(ticket.id, fromStorage);
      return { ...ticket, attachments: fromStorage };
    }
  } catch {
    // Storage list optional if policies not applied yet.
  }
  return ticket;
}

async function saveTicketAttachments(ticketId: string, attachments: SupportTicketAttachment[]): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_SupportTickets")
    .update({
      attachments,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ticketId);

  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Cannot update attachments: run supabase/support_tickets_admin.sql in Supabase."
        : error.message
    );
  }
}

export async function getSupportTickets(query: SupportTicketsQuery = {}): Promise<SupportTicket[]> {
  const { status = "all", priority = "all", search = "", dateFrom, dateTo, limit = 200 } = query;

  let q = requireSupabase()
    .from("EV_SupportTickets")
    .select(TICKET_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status !== "all") q = q.eq("status", status);
  if (priority !== "all") q = q.eq("priority", priority);
  if (dateFrom) q = q.gte("created_at", isoDayStart(dateFrom));
  if (dateTo) q = q.lte("created_at", isoDayEnd(dateTo));

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
  if (!data) return null;
  return hydrateAttachmentsFromStorage(mapRow(data as Record<string, unknown>));
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

export async function uploadAdminTicketAttachments(
  ticketId: string,
  files: File[]
): Promise<SupportTicketAttachment[]> {
  if (!files.length) return [];

  const ticket = await getSupportTicketById(ticketId);
  if (!ticket) throw new Error("Ticket not found");

  if (ticket.attachments.length + files.length > MAX_SUPPORT_TICKET_ATTACHMENTS) {
    throw new Error(`Maximum ${MAX_SUPPORT_TICKET_ATTACHMENTS} attachments per ticket`);
  }

  const uploaded: SupportTicketAttachment[] = [];
  for (const file of files) {
    const item = await mediaService.uploadSupportTicketAttachment(ticket.userId, ticketId, file);
    uploaded.push(item);
  }

  const merged = [...ticket.attachments, ...uploaded];
  await saveTicketAttachments(ticketId, merged);
  return merged;
}
