import {
  buildTransactionalEmail,
  formatIndianDateTime,
  labelizeStatus,
  type BuiltEmail,
} from "@/utils/emailTemplates";

export type PowerAutomateEmailType =
  | "test"
  | "user_welcome"
  | "account_activated"
  | "password_changed"
  | "ticket_assigned"
  | "ticket_status_updated"
  | "ticket_closed"
  | "unauthorized_login_alert"
  | "email_otp"
  | "admin_alert";

export interface PowerAutomateEmailPayload {
  emailType: PowerAutomateEmailType;
  to: string;
  subject: string;
  /** HTML email body — map this to Power Automate "Body" with Is HTML = Yes */
  body: string;
  bodyHtml: string;
  /** Plain-text fallback for clients that do not render HTML */
  bodyPlain: string;
  isHtml: boolean;
  source: string;
  data?: Record<string, string>;
}

export interface PowerAutomateEmailResult {
  success: boolean;
  message?: string;
  error?: string;
}

const POWER_AUTOMATE_API = "/api/power-automate/email";
const PORTAL_URL =
  typeof window !== "undefined" ? `${window.location.origin}/login` : "https://ev-cms-rho.vercel.app/login";

async function postPowerAutomateEmail(
  payload: PowerAutomateEmailPayload
): Promise<PowerAutomateEmailResult> {
  try {
    const res = await fetch(POWER_AUTOMATE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
      error?: string;
    };

    if (!res.ok) {
      return {
        success: false,
        error: data.error ?? `Request failed (${res.status}). Check Power Automate flow is ON.`,
      };
    }

    return {
      success: true,
      message: data.message ?? "Email accepted by Power Automate.",
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Could not reach the email proxy API.",
    };
  }
}

async function sendBuiltEmail(
  emailType: PowerAutomateEmailType,
  to: string,
  built: BuiltEmail,
  source: string,
  data?: Record<string, string>
): Promise<PowerAutomateEmailResult> {
  const recipient = to.trim();
  if (!recipient) return { success: false, error: "Recipient email is required." };

  return postPowerAutomateEmail({
    emailType,
    to: recipient,
    subject: built.subject,
    body: built.bodyHtml,
    bodyHtml: built.bodyHtml,
    bodyPlain: built.body,
    isHtml: true,
    source,
    data,
  });
}

function roleLabel(role: string): string {
  if (role === "SuperAdmin") return "Super Admin";
  if (role === "SiteAdmin") return "Site Admin";
  return "Mobile user";
}

// —— User & account ——

export interface WelcomeEmailInput {
  name: string;
  email: string;
  role: string;
  department: string;
  joinedDate: string;
  status: "active" | "inactive";
}

export async function sendWelcomeEmail(input: WelcomeEmailInput): Promise<PowerAutomateEmailResult> {
  const built = buildTransactionalEmail({
    preheader: "Your DFCCIL EV-CMS account has been created.",
    headline: "Welcome to DFCCIL EV-CMS",
    greeting: `Hello ${input.name},`,
    intro:
      input.status === "active"
        ? "Your account has been created and is ready to use. Please sign in and change your password after your first login."
        : "Your account has been created but is currently inactive. Your administrator will activate access when ready.",
    tone: "success",
    badge: "Account created",
    details: [
      { label: "Email", value: input.email },
      { label: "Role", value: roleLabel(input.role) },
      { label: "Department", value: input.department },
      { label: "Joining date", value: input.joinedDate },
      { label: "Status", value: input.status === "active" ? "Active" : "Inactive" },
    ],
    bullets:
      input.status === "active"
        ? [
            input.role === "User"
              ? "Use the EV-CMS mobile app for charging sessions."
              : "Use the EV-CMS web portal to manage chargers and operations.",
            "Change your password from Settings after first login.",
            "Contact your site administrator if you need RFID assignment.",
          ]
        : ["Contact your site administrator to activate your account."],
    ctaLabel: input.status === "active" && input.role !== "User" ? "Open web portal" : undefined,
    ctaUrl: input.status === "active" && input.role !== "User" ? PORTAL_URL : undefined,
  });
  built.subject = "Welcome to DFCCIL EV-CMS — your account is ready";

  return sendBuiltEmail("user_welcome", input.email, built, "ev-cms-users", {
    fullName: input.name,
    role: roleLabel(input.role),
  });
}

export interface AccountActivatedEmailInput {
  name: string;
  email: string;
  role: string;
}

export async function sendAccountActivatedEmail(
  input: AccountActivatedEmailInput
): Promise<PowerAutomateEmailResult> {
  const built = buildTransactionalEmail({
    preheader: "Your EV-CMS account is now active.",
    headline: "Your account is active",
    greeting: `Hello ${input.name},`,
    intro: "Good news — your DFCCIL EV-CMS account has been activated. You can now sign in with your DFCCIL email.",
    tone: "success",
    badge: "Account activated",
    details: [
      { label: "Email", value: input.email },
      { label: "Role", value: roleLabel(input.role) },
      { label: "Activated on", value: formatIndianDateTime() },
    ],
    bullets: [
      "If this was unexpected, contact your IT administrator immediately.",
      "Change your password regularly from Settings → Security.",
    ],
    ctaLabel: input.role !== "User" ? "Sign in to web portal" : undefined,
    ctaUrl: input.role !== "User" ? PORTAL_URL : undefined,
    footerNote: input.role === "User" ? "Mobile users should open the EV-CMS app on their phone to sign in." : undefined,
  });
  built.subject = "Your DFCCIL EV-CMS account is now active";

  return sendBuiltEmail("account_activated", input.email, built, "ev-cms-users", {
    fullName: input.name,
  });
}

export interface PasswordChangedEmailInput {
  name: string;
  email: string;
}

export async function sendPasswordChangedEmail(
  input: PasswordChangedEmailInput
): Promise<PowerAutomateEmailResult> {
  const built = buildTransactionalEmail({
    preheader: "Your EV-CMS password was changed.",
    headline: "Password changed successfully",
    greeting: `Hello ${input.name},`,
    intro: "This confirms that your DFCCIL EV-CMS account password was changed successfully.",
    tone: "info",
    badge: "Security",
    details: [
      { label: "Account", value: input.email },
      { label: "Changed on", value: formatIndianDateTime() },
    ],
    bullets: [
      "If you made this change, no further action is needed.",
      "If you did not change your password, contact IT support immediately and reset your credentials.",
    ],
    footerNote: "For security, never share your password with anyone.",
  });
  built.subject = "DFCCIL EV-CMS — your password was changed";

  return sendBuiltEmail("password_changed", input.email, built, "ev-cms-settings", {
    fullName: input.name,
  });
}

export interface EmailOtpVerificationInput {
  name: string;
  email: string;
  otp: string;
}

export async function sendEmailOtpVerification(
  input: EmailOtpVerificationInput
): Promise<PowerAutomateEmailResult> {
  const built = buildTransactionalEmail({
    preheader: `Your verification code is ${input.otp}. Valid for 10 minutes.`,
    headline: "Verify your email address",
    greeting: `Hello ${input.name},`,
    intro:
      "Enter the verification code below in the EV-CMS portal to confirm your new email address.\n\nDo not share this code with anyone — our team will never ask for it.",
    tone: "info",
    badge: "Email verification",
    highlight: {
      label: "Your verification code",
      value: input.otp,
      hint: "Valid for 10 minutes · Single use only",
    },
    details: [{ label: "Requested at", value: formatIndianDateTime() }],
    bullets: [
      "If you did not request this change, ignore this email and contact IT support.",
      "Requested from Settings → Profile on the EV-CMS web portal.",
    ],
  });
  built.subject = "DFCCIL EV-CMS — your email verification code";

  return sendBuiltEmail("email_otp", input.email, built, "ev-cms-settings", {
    fullName: input.name,
    otp: input.otp,
  });
}

// —— Support tickets ——

function ticketDetailsRows(ticket: {
  id: string;
  subject: string;
  status: string;
  priority: string;
  userName: string;
}): { label: string; value: string }[] {
  return [
    { label: "Ticket ID", value: ticket.id.slice(0, 8).toUpperCase() },
    { label: "Subject", value: ticket.subject },
    { label: "Status", value: labelizeStatus(ticket.status) },
    { label: "Priority", value: labelizeStatus(ticket.priority) },
    { label: "Requester", value: ticket.userName },
  ];
}

export interface TicketAssignedEmailInput {
  assigneeName: string;
  assigneeEmail: string;
  ticket: {
    id: string;
    subject: string;
    description: string;
    status: string;
    priority: string;
    userName: string;
    userEmail: string;
  };
}

export async function sendTicketAssignedEmail(
  input: TicketAssignedEmailInput
): Promise<PowerAutomateEmailResult> {
  const built = buildTransactionalEmail({
    preheader: `Support ticket assigned: ${input.ticket.subject}`,
    headline: "Support ticket assigned to you",
    greeting: `Hello ${input.assigneeName},`,
    intro: "A support ticket has been assigned to you in the DFCCIL EV-CMS admin portal. Please review and take action.",
    tone: "info",
    badge: "Action required",
    details: ticketDetailsRows(input.ticket),
    bullets: [
      `Requester email: ${input.ticket.userEmail}`,
      "Open Support Tickets in the admin portal to view full details and attachments.",
    ],
    ctaLabel: "Open support tickets",
    ctaUrl: typeof window !== "undefined" ? `${window.location.origin}/support-tickets` : undefined,
  });
  built.subject = `Support ticket assigned — ${input.ticket.subject}`;

  return sendBuiltEmail("ticket_assigned", input.assigneeEmail, built, "ev-cms-support", {
    ticketId: input.ticket.id,
  });
}

export interface TicketStatusUpdatedEmailInput {
  recipientName: string;
  recipientEmail: string;
  ticket: {
    id: string;
    subject: string;
    status: string;
    priority: string;
    userName: string;
  };
  previousStatus: string;
}

export async function sendTicketStatusUpdatedEmail(
  input: TicketStatusUpdatedEmailInput
): Promise<PowerAutomateEmailResult> {
  const built = buildTransactionalEmail({
    preheader: `Ticket status updated: ${labelizeStatus(input.ticket.status)}`,
    headline: "Support ticket status updated",
    greeting: `Hello ${input.recipientName},`,
    intro: `The status of your support request has been updated from ${labelizeStatus(input.previousStatus)} to ${labelizeStatus(input.ticket.status)}.`,
    tone: "info",
    badge: labelizeStatus(input.ticket.status),
    details: ticketDetailsRows(input.ticket),
    footerNote: "You can view ticket details in the EV-CMS mobile app under Support → My tickets.",
  });
  built.subject = `Ticket update — ${input.ticket.subject}`;

  return sendBuiltEmail("ticket_status_updated", input.recipientEmail, built, "ev-cms-support", {
    ticketId: input.ticket.id,
    status: input.ticket.status,
  });
}

export interface TicketClosedEmailInput {
  recipientName: string;
  recipientEmail: string;
  ticket: {
    id: string;
    subject: string;
    status: string;
    priority: string;
    userName: string;
  };
}

export async function sendTicketClosedEmail(
  input: TicketClosedEmailInput
): Promise<PowerAutomateEmailResult> {
  const built = buildTransactionalEmail({
    preheader: `Your support ticket has been closed: ${input.ticket.subject}`,
    headline: "Support ticket closed",
    greeting: `Hello ${input.recipientName},`,
    intro:
      "Your support request has been marked as closed. If you still need help, you can open a new ticket from the mobile app.",
    tone: "success",
    badge: "Closed",
    details: ticketDetailsRows(input.ticket),
    bullets: [
      "Thank you for using DFCCIL EV-CMS support.",
      "We hope your issue was resolved satisfactorily.",
    ],
  });
  built.subject = `Ticket closed — ${input.ticket.subject}`;

  return sendBuiltEmail("ticket_closed", input.recipientEmail, built, "ev-cms-support", {
    ticketId: input.ticket.id,
  });
}

// —— Security ——

export interface UnauthorizedLoginAlertInput {
  adminEmail: string;
  attemptedEmail: string;
  failureCount: number;
  lastReason: string;
}

export async function sendUnauthorizedLoginAlert(
  input: UnauthorizedLoginAlertInput
): Promise<PowerAutomateEmailResult> {
  const built = buildTransactionalEmail({
    preheader: `Security alert: ${input.failureCount} failed web login attempts`,
    headline: "Unauthorized login attempt detected",
    intro:
      "Multiple failed sign-in attempts were detected on the DFCCIL EV-CMS web portal. Please review this activity.",
    tone: "security",
    badge: "Security alert",
    details: [
      { label: "Attempted email", value: input.attemptedEmail },
      { label: "Failed attempts", value: String(input.failureCount) },
      { label: "Last reason", value: input.lastReason },
      { label: "Detected at", value: formatIndianDateTime() },
    ],
    bullets: [
      "Verify whether this was a legitimate user who forgot their password.",
      "If suspicious, consider deactivating the account from Users management.",
      "Check Audit Logs for related activity.",
    ],
    footerNote: "This alert is sent after 3 failed login attempts within 15 minutes.",
  });
  built.subject = `Security alert — failed login attempts for ${input.attemptedEmail}`;

  return sendBuiltEmail("unauthorized_login_alert", input.adminEmail, built, "ev-cms-security", {
    attemptedEmail: input.attemptedEmail,
    failureCount: String(input.failureCount),
  });
}

export async function notifyAdminsUnauthorizedLogin(input: {
  attemptedEmail: string;
  failureCount: number;
  lastReason: string;
  adminEmails: string[];
}): Promise<void> {
  const extra = (import.meta.env.VITE_SECURITY_ALERT_EMAIL as string | undefined)
    ?.split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  const recipients = [...new Set([...input.adminEmails, ...(extra ?? [])])];
  if (!recipients.length) return;

  await Promise.allSettled(
    recipients.map((adminEmail) =>
      sendUnauthorizedLoginAlert({
        adminEmail,
        attemptedEmail: input.attemptedEmail,
        failureCount: input.failureCount,
        lastReason: input.lastReason,
      })
    )
  );
}

// —— Admin alerts (notification prefs) ——

export interface AdminAlertEmailInput {
  name: string;
  email: string;
  subject: string;
  headline: string;
  intro: string;
  tone?: "info" | "warning" | "security" | "success";
}

export async function sendAdminAlertEmail(
  input: AdminAlertEmailInput
): Promise<PowerAutomateEmailResult> {
  const built = buildTransactionalEmail({
    preheader: input.intro.slice(0, 120),
    headline: input.headline,
    greeting: `Hello ${input.name},`,
    intro: input.intro,
    tone: input.tone ?? "info",
    badge: "EV-CMS alert",
    footerNote: "You received this because the alert is enabled under Settings → Notifications.",
  });
  built.subject = input.subject;

  return sendBuiltEmail("admin_alert", input.email, built, "ev-cms-notifications", {
    fullName: input.name,
  });
}

// —— Dev test ——

export interface TestEmailInput {
  to: string;
  subject?: string;
  body?: string;
}

export async function sendTestEmail(input: TestEmailInput): Promise<PowerAutomateEmailResult> {
  const built = buildTransactionalEmail({
    preheader: "EV-CMS test email",
    headline: "Test email",
    intro: input.body ?? `This is a test email from the DFCCIL EV-CMS login page.\n\nSent at: ${new Date().toISOString()}`,
    tone: "info",
    badge: "Test",
  });
  built.subject = input.subject ?? "EV-CMS Test Email";

  return sendBuiltEmail("test", input.to, built, "ev-cms-login");
}

/** Fire-and-forget helper — logs errors only in dev. */
export function sendEmailInBackground(promise: Promise<PowerAutomateEmailResult>): void {
  void promise.catch((err) => {
    if (import.meta.env.DEV) {
      console.warn("[email]", err);
    }
  });
}
