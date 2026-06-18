import { requireSupabase } from "../utils/supabaseClient";

const BUCKET = "ev-media";
const AVATAR_RE = /^avatar\.(jpg|jpeg|png|webp|gif)$/i;
const SUPPORT_TICKETS_ROOT = "support-tickets";

/** Storage path: EV/{userId}/{fileName} */
export function userMediaPath(userId: string, fileName: string): string {
  return `EV/${userId}/${fileName}`;
}

/** Storage path: support-tickets/{userId}/{ticketId}/{fileName} */
export function supportTicketMediaPath(userId: string, ticketId: string, fileName: string): string {
  return `${SUPPORT_TICKETS_ROOT}/${userId}/${ticketId}/${fileName}`;
}

export interface UploadedSupportAttachment {
  name: string;
  path: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

function extFromMime(mime?: string | null): string {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("pdf")) return "pdf";
  return "jpg";
}

function contentTypeForExt(ext: string): string {
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "pdf") return "application/pdf";
  return "image/jpeg";
}

function safeFileName(originalName: string): string {
  const trimmed = originalName.trim() || "attachment";
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `${Date.now()}-${sanitized}`;
}

async function uriToBlob(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error("Could not read image file");
  return await res.blob();
}

async function uploadAvatarToSupabase(userId: string, uri: string, mimeType?: string | null): Promise<string> {
  const supabase = requireSupabase();
  const ext = extFromMime(mimeType);
  const fileName = `avatar.${ext}`;
  const path = userMediaPath(userId, fileName);
  const blob = await uriToBlob(uri);

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: mimeType ?? contentTypeForExt(ext),
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
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

/**
 * Upload avatar and return public URL. (Supabase Storage `ev-media` bucket)
 */
export async function uploadUserAvatar(userId: string, uri: string, mimeType?: string | null): Promise<string> {
  return uploadAvatarToSupabase(userId, uri, mimeType);
}

/**
 * Deletes any existing `avatar.*` for the user from Storage.
 * Does NOT update DB; caller should set `avatar_url = null`.
 */
export async function deleteUserAvatar(userId: string): Promise<void> {
  await deleteSupabaseAvatars(userId);
}

/**
 * Replace avatar safely by deleting previous file(s) first, then uploading new.
 */
export async function replaceUserAvatar(userId: string, uri: string, mimeType?: string | null): Promise<string> {
  await deleteUserAvatar(userId);
  return uploadUserAvatar(userId, uri, mimeType);
}

export async function uploadSupportTicketAttachment(
  userId: string,
  ticketId: string,
  uri: string,
  options: { mimeType?: string | null; name?: string } = {}
): Promise<UploadedSupportAttachment> {
  const supabase = requireSupabase();
  const mimeType = options.mimeType ?? "image/jpeg";
  const ext = extFromMime(mimeType);
  const baseName = options.name?.includes(".") ? options.name : `${options.name ?? "attachment"}.${ext}`;
  const fileName = safeFileName(baseName);
  const path = supportTicketMediaPath(userId, ticketId, fileName);
  const blob = await uriToBlob(uri);

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: false,
    contentType: mimeType,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return {
    name: fileName,
    path,
    url: data.publicUrl,
    mimeType,
    size: blob.size,
    uploadedAt: new Date().toISOString(),
  };
}

export async function listSupportTicketAttachments(
  userId: string,
  ticketId: string
): Promise<UploadedSupportAttachment[]> {
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
      size: file.metadata?.size ? Number(file.metadata.size) : 0,
      uploadedAt: file.created_at ?? new Date().toISOString(),
    };
  });
}

