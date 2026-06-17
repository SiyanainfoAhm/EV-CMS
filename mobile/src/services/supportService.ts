import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import type { SupportTicket } from "../types";

export interface SupportTicketInput {
  subject: string;
  description: string;
  priority?: string;
  category?: string;
}

function mapTicket(row: Record<string, unknown>): SupportTicket {
  return {
    id: row.id as string,
    subject: row.subject as string,
    description: row.description as string,
    status: row.status as string,
    priority: row.priority as string,
    category: (row.category as string) ?? undefined,
    createdAt: row.created_at as string,
  };
}

export const getTickets = getSupportTickets;

export async function getSupportTickets(userId?: string): Promise<SupportTicket[]> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_SupportTickets")
    .select("id, subject, description, status, priority, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapTicket(row as Record<string, unknown>));
}

export async function getTicketById(ticketId: string, userId?: string): Promise<SupportTicket | null> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_SupportTickets")
    .select("id, subject, description, status, priority, created_at")
    .eq("id", ticketId)
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return data ? mapTicket(data as Record<string, unknown>) : null;
}

export async function createSupportTicket(input: SupportTicketInput, userId?: string): Promise<string> {
  const uid = userId ?? requireUserId();
  const subject = input.subject.trim();
  const description = input.description.trim();
  if (!subject || !description) {
    throw new Error("Subject and message are required");
  }

  const { data, error } = await requireSupabase()
    .from("EV_SupportTickets")
    .insert({
      user_id: uid,
      subject,
      description,
      status: "open",
      priority: input.priority ?? "normal",
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Cannot create ticket: run mobile/SUPABASE_MOBILE_POLICIES.sql in Supabase."
        : error.message
    );
  }

  return (data as { id: string }).id;
}
