export type EmailTone = "success" | "info" | "warning" | "security";

export interface EmailDetailRow {
  label: string;
  value: string;
}

export interface EmailHighlight {
  label: string;
  value: string;
  hint?: string;
}

export interface BuiltEmail {
  subject: string;
  body: string;
  bodyHtml: string;
}

const TONE_COLORS: Record<EmailTone, { accent: string; badge: string; badgeText: string }> = {
  success: { accent: "#059669", badge: "#d1fae5", badgeText: "#065f46" },
  info: { accent: "#2563eb", badge: "#dbeafe", badgeText: "#1e40af" },
  warning: { accent: "#d97706", badge: "#fef3c7", badgeText: "#92400e" },
  security: { accent: "#dc2626", badge: "#fee2e2", badgeText: "#991b1b" },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMultilineHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br />");
}

function buildHighlightHtml(highlight: EmailHighlight, accent: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;">
    <tr>
      <td align="center" style="padding:28px 20px;background:#f8fafc;border:2px dashed ${accent};border-radius:14px;">
        <p style="margin:0 0 10px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">${escapeHtml(highlight.label)}</p>
        <p style="margin:0;font-size:40px;line-height:1.1;font-weight:800;letter-spacing:10px;color:${accent};font-family:'Courier New',Consolas,monospace;">${escapeHtml(highlight.value)}</p>
        ${highlight.hint ? `<p style="margin:14px 0 0;font-size:13px;color:#94a3b8;">${escapeHtml(highlight.hint)}</p>` : ""}
      </td>
    </tr>
  </table>`;
}

function buildPlainTextEmail(input: {
  headline: string;
  greeting?: string;
  intro: string;
  highlight?: EmailHighlight;
  details?: EmailDetailRow[];
  bullets?: string[];
  footerNote?: string;
}): string {
  const divider = "────────────────────────────────";
  const lines: string[] = ["DFCCIL EV-CMS", divider, "", input.headline, ""];

  if (input.greeting) lines.push(input.greeting, "");
  lines.push(input.intro, "");

  if (input.highlight) {
    lines.push(divider, input.highlight.label.toUpperCase(), "", `    ${input.highlight.value}`, "");
    if (input.highlight.hint) lines.push(`    ${input.highlight.hint}`, "");
    lines.push(divider, "");
  }

  if (input.details?.length) {
    for (const row of input.details) {
      lines.push(`${row.label}: ${row.value}`);
    }
    lines.push("");
  }

  if (input.bullets?.length) {
    for (const bullet of input.bullets) {
      lines.push(`• ${bullet}`);
    }
    lines.push("");
  }

  if (input.footerNote) {
    lines.push(input.footerNote, "");
  }

  lines.push("— DFCCIL EV-CMS", "Authorized personnel only. Automated message.");
  return lines.join("\n");
}

export function buildTransactionalEmail(input: {
  preheader: string;
  headline: string;
  greeting?: string;
  intro: string;
  tone?: EmailTone;
  badge?: string;
  highlight?: EmailHighlight;
  details?: EmailDetailRow[];
  bullets?: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}): BuiltEmail {
  const tone = input.tone ?? "info";
  const colors = TONE_COLORS[tone];
  const greeting = input.greeting ? `<p style="margin:0 0 16px;font-size:15px;color:#374151;">${escapeHtml(input.greeting)}</p>` : "";
  const badge = input.badge
    ? `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${colors.badge};color:${colors.badgeText};font-size:12px;font-weight:600;margin-bottom:16px;">${escapeHtml(input.badge)}</span>`
    : "";

  const detailsHtml =
    input.details && input.details.length > 0
      ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:20px 0;border-collapse:collapse;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
          ${input.details
            .map(
              (row, index) => `<tr>
                <td style="padding:12px 16px;font-size:13px;color:#6b7280;width:38%;border-top:${index === 0 ? "0" : "1px solid #e5e7eb"};background:#f3f4f6;font-weight:600;">${escapeHtml(row.label)}</td>
                <td style="padding:12px 16px;font-size:14px;color:#111827;border-top:${index === 0 ? "0" : "1px solid #e5e7eb"};">${escapeHtml(row.value)}</td>
              </tr>`
            )
            .join("")}
        </table>`
      : "";

  const bulletsHtml =
    input.bullets && input.bullets.length > 0
      ? `<ul style="margin:16px 0 0;padding-left:20px;color:#374151;font-size:14px;line-height:1.6;">
          ${input.bullets.map((b) => `<li style="margin-bottom:8px;">${escapeHtml(b)}</li>`).join("")}
        </ul>`
      : "";

  const highlightHtml = input.highlight ? buildHighlightHtml(input.highlight, colors.accent) : "";

  const ctaHtml =
    input.ctaLabel && input.ctaUrl
      ? `<p style="margin:24px 0 0;">
          <a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;background:${colors.accent};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(input.ctaLabel)}</a>
        </p>`
      : "";

  const footerNote = input.footerNote
    ? `<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">${formatMultilineHtml(input.footerNote)}</p>`
    : "";

  const bodyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(input.headline)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(input.preheader)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 8px 24px rgba(17,24,39,0.06);">
          <tr>
            <td style="background:linear-gradient(135deg,#047857 0%,#065f46 100%);padding:24px 28px;">
              <p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#d1fae5;font-weight:700;">DFCCIL EV-CMS</p>
              <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;color:#ffffff;font-weight:700;">${escapeHtml(input.headline)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${badge}
              ${greeting}
              <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${formatMultilineHtml(input.intro)}</p>
              ${highlightHtml}
              ${detailsHtml}
              ${bulletsHtml}
              ${ctaHtml}
              ${footerNote}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                DFCCIL Authorized Personnel Only. This is an automated message from the EV Charger Management System.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: "",
    body: buildPlainTextEmail(input),
    bodyHtml,
  };
}

export function labelizeStatus(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatIndianDateTime(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
