import { requireSupabase } from "@/utils/supabaseClient";

const BUCKET = "ev-media";

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
