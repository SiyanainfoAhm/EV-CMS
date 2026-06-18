import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import * as mediaService from "./mediaService";
import type { SupportTicket, SupportTicketAttachment } from "../types";

export interface SupportTicketInput {
  subject: string;
  description: string;
  priority?: string;
  category?: string;
}

export interface SupportTicketAttachmentInput {
  uri: string;
  mimeType?: string | null;
  name?: string;
}

function parseAttachments(value: unknown): SupportTicketAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        name: String(row.name ?? "attachment"),
        path: String(row.path ?? ""),
        url: String(row.url ?? ""),
        mimeType: String(row.mimeType ?? "application/octet-stream"),
        size: row.size != null ? Number(row.size) : undefined,
        uploadedAt: String(row.uploadedAt ?? row.uploaded_at ?? new Date().toISOString()),
      };
    })
    .filter((item) => item.url);
}

function mapTicket(row: Record<string, unknown>): SupportTicket {
  return {
    id: row.id as string,
    subject: row.subject as string,
    description: row.description as string,
    status: row.status as string,
    priority: row.priority as string,
    category: (row.category as string) ?? undefined,
    attachments: parseAttachments(row.attachments),
    createdAt: row.created_at as string,
  };
}

export const getTickets = getSupportTickets;

export async function getSupportTickets(userId?: string): Promise<SupportTicket[]> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_SupportTickets")
    .select("id, subject, description, status, priority, attachments, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapTicket(row as Record<string, unknown>));
}

export async function getTicketById(ticketId: string, userId?: string): Promise<SupportTicket | null> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_SupportTickets")
    .select("id, subject, description, status, priority, attachments, created_at")
    .eq("id", ticketId)
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const ticket = mapTicket(data as Record<string, unknown>);
  if (ticket.attachments.length > 0) return ticket;

  try {
    const fromStorage = await mediaService.listSupportTicketAttachments(uid, ticketId);
    if (fromStorage.length > 0) {
      return { ...ticket, attachments: fromStorage };
    }
  } catch {
    // Storage list optional if policies not applied yet.
  }

  return ticket;
}

async function saveTicketAttachments(
  ticketId: string,
  attachments: SupportTicketAttachment[],
  userId: string
): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_SupportTickets")
    .update({
      attachments,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ticketId)
    .eq("user_id", userId);

  if (error) throw error;
}

export async function uploadTicketAttachments(
  ticketId: string,
  files: SupportTicketAttachmentInput[],
  userId?: string
): Promise<SupportTicketAttachment[]> {
  const uid = userId ?? requireUserId();
  if (!files.length) return [];

  const ticket = await getTicketById(ticketId, uid);
  if (!ticket) throw new Error("Ticket not found");

  const uploaded: SupportTicketAttachment[] = [];
  for (const file of files) {
    const item = await mediaService.uploadSupportTicketAttachment(uid, ticketId, file.uri, {
      mimeType: file.mimeType,
      name: file.name,
    });
    uploaded.push(item);
  }

  const merged = [...ticket.attachments, ...uploaded];
  await saveTicketAttachments(ticketId, merged, uid);
  return merged;
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
      attachments: [],
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

export async function createSupportTicketWithAttachments(
  input: SupportTicketInput,
  attachments: SupportTicketAttachmentInput[] = [],
  userId?: string
): Promise<string> {
  const ticketId = await createSupportTicket(input, userId);
  if (attachments.length > 0) {
    await uploadTicketAttachments(ticketId, attachments, userId);
  }
  return ticketId;
}
