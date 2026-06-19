import type { SupportTicketAttachment } from "@/types/ev";

export const MAX_SUPPORT_TICKET_ATTACHMENTS = 5;

export const SUPPORT_ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,application/pdf";

export function parseSupportTicketAttachments(value: unknown): SupportTicketAttachment[] {
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

export function isImageAttachment(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function formatAttachmentSize(bytes?: number): string {
  if (bytes == null || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
