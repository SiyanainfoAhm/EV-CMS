import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";

export interface SupportTicketInput {
  subject: string;
  description: string;
  priority?: string;
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
