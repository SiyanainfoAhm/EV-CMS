import { requireSupabase } from "../utils/supabaseClient";

const BUCKET = "ev-media";
const AVATAR_RE = /^avatar\.(jpg|jpeg|png|webp|gif)$/i;

/** Storage path: EV/{userId}/{fileName} */
export function userMediaPath(userId: string, fileName: string): string {
  return `EV/${userId}/${fileName}`;
}

function extFromMime(mime?: string | null): string {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  return "jpg";
}

function contentTypeForExt(ext: string): string {
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
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

