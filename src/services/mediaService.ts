import type { SupportTicketAttachment } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";

const BUCKET = "ev-media";
const AVATAR_RE = /^avatar\.(jpg|jpeg|png|webp|gif)$/i;
const SUPPORT_TICKETS_ROOT = "support-tickets";
const SUPPORT_MAX_BYTES = 10 * 1024 * 1024;
const SUPPORT_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

/** Storage path: EV/{userId}/{fileName} */
export function userMediaPath(userId: string, fileName: string): string {
  return `EV/${userId}/${fileName}`;
}

function extensionFromFile(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && ["jpg", "jpeg", "png", "webp", "gif"].includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}

async function uploadToSupabase(userId: string, file: File, fileName: string): Promise<string> {
  const supabase = requireSupabase();
  const path = userMediaPath(userId, fileName);
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || "image/jpeg",
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function uploadToLocalApi(userId: string, file: File, fileName: string): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const data = btoa(binary);

  const res = await fetch(`/api/ev-media/${userId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, fileName }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Local upload failed");
  }
  const json = (await res.json()) as { url: string };
  return json.url;
}

/**
 * Upload user media to EV/{userId}/ (Supabase Storage, or local uploads/EV/{userId}/ in dev).
 */
export async function uploadUserAvatar(userId: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please select an image file");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Image must be under 5 MB");
  }

  const ext = extensionFromFile(file);
  const fileName = `avatar.${ext}`;

  try {
    return await uploadToSupabase(userId, file, fileName);
  } catch (supabaseErr) {
    console.warn("[mediaService] Supabase upload failed, trying local API:", supabaseErr);
    try {
      return await uploadToLocalApi(userId, file, fileName);
    } catch {
      throw supabaseErr instanceof Error ? supabaseErr : new Error("Upload failed");
    }
  }
}

async function deleteSupabaseAvatars(userId: string): Promise<void> {
  const supabase = requireSupabase();
  const prefix = `EV/${userId}`;
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 100 });
  if (error) throw error;
  const names = (data ?? []).map((x) => x.name).filter((n) => AVATAR_RE.test(n));
  if (!names.length) return;
  const paths = names.map((n) => `${prefix}/${n}`);
  const { error: removeErr } = await supabase.storage.from(BUCKET).remove(paths);
  if (removeErr) throw removeErr;
}

async function deleteLocalAvatars(userId: string): Promise<void> {
  // Local dev API deletes avatar.* under uploads/EV/{userId}/
  await fetch(`/api/ev-media/${userId}`, { method: "DELETE" });
}

/**
 * Deletes any existing `avatar.*` for the user from Storage (or local uploads in dev).
 * Does NOT update DB; caller should set `avatar_url = null`.
 */
export async function deleteUserAvatar(userId: string): Promise<void> {
  try {
    await deleteSupabaseAvatars(userId);
  } catch (supabaseErr) {
    console.warn("[mediaService] Supabase delete failed, trying local API:", supabaseErr);
    await deleteLocalAvatars(userId);
  }
}

/**
 * Replace avatar safely by deleting previous file(s) first, then uploading new.
 */
export async function replaceUserAvatar(userId: string, file: File): Promise<string> {
  await deleteUserAvatar(userId);
  return uploadUserAvatar(userId, file);
}

/** Storage path: support-tickets/{userId}/{ticketId}/{fileName} */
export function supportTicketMediaPath(userId: string, ticketId: string, fileName: string): string {
  return `${SUPPORT_TICKETS_ROOT}/${userId}/${ticketId}/${fileName}`;
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("pdf")) return "pdf";
  return "jpg";
}

function contentTypeForExt(ext: string): string {
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "pdf") return "application/pdf";
  return "image/jpeg";
}

function safeSupportFileName(originalName: string): string {
  const trimmed = originalName.trim() || "attachment";
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `${Date.now()}-${sanitized}`;
}

function validateSupportAttachmentFile(file: File): void {
  const mime = file.type || "application/octet-stream";
  if (!SUPPORT_ALLOWED_TYPES.has(mime)) {
    throw new Error("Only JPEG, PNG, WebP, GIF, and PDF files are allowed");
  }
  if (file.size > SUPPORT_MAX_BYTES) {
    throw new Error("Each file must be under 10 MB");
  }
}

export async function uploadSupportTicketAttachment(
  userId: string,
  ticketId: string,
  file: File
): Promise<SupportTicketAttachment> {
  validateSupportAttachmentFile(file);
  const supabase = requireSupabase();
  const mimeType = file.type || "application/octet-stream";
  const ext = extFromMime(mimeType);
  const baseName = file.name.includes(".") ? file.name : `${file.name || "attachment"}.${ext}`;
  const fileName = safeSupportFileName(baseName);
  const path = supportTicketMediaPath(userId, ticketId, fileName);

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: mimeType,
  });
  if (error) {
    throw new Error(
      error.message.includes("policy")
        ? "Upload denied: run mobile/SUPPORT_TICKET_ATTACHMENTS.sql on Supabase."
        : error.message
    );
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return {
    name: fileName,
    path,
    url: data.publicUrl,
    mimeType,
    size: file.size,
    uploadedAt: new Date().toISOString(),
  };
}

export async function listSupportTicketAttachments(
  userId: string,
  ticketId: string
): Promise<SupportTicketAttachment[]> {
  const supabase = requireSupabase();
  const prefix = `${SUPPORT_TICKETS_ROOT}/${userId}/${ticketId}`;
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 100 });
  if (error) throw error;

  return (data ?? []).map((file) => {
    const path = `${prefix}/${file.name}`;
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return {
      name: file.name,
      path,
      url: urlData.publicUrl,
      mimeType: contentTypeForExt(file.name.split(".").pop() ?? "jpg"),
      size: file.metadata?.size ? Number(file.metadata.size) : undefined,
      uploadedAt: file.created_at ?? new Date().toISOString(),
    };
  });
}
