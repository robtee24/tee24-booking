/**
 * Front-desk copy of a message a member wrote in the portal (Contact → "Send
 * us a message").
 *
 * The message itself is stored on the member's conversation, so it shows in the
 * admin Inbox and on the member's profile. This emails the same message to the
 * front-desk mailbox (info@tee24.golf unless EMAIL_REPLY_TO says otherwise) so
 * it is also seen by whoever watches that mailbox.
 *
 *  • Reply-To is the member, so hitting Reply in the mailbox answers them —
 *    the same as the website contact-form email.
 *  • Not written to the message ledger: the member's message is already on
 *    their thread, and this copy would only show up as a second row.
 *  • When the mailbox forwards its mail to the admin inbox, this copy comes back
 *    from our own sending address and is skipped there (`classifyInboundEmail`).
 */
import { sendEmail } from "@/lib/sendEmail";
import { fallbackReplyTo } from "@/lib/inbound-email";

export type MemberMessageCopyInput = {
  member: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    locationName?: string | null;
  };
  subject?: string | null;
  /** Quick-link topic chosen in the portal, e.g. "request_freeze". */
  topic?: string | null;
  body: string;
  /** How the member asked to be answered. */
  replyBy: "EMAIL" | "SMS";
  /** Admin-console paths (e.g. `/admin/locations/x/marketing/inbox?c=…`); made absolute here. */
  conversationPath?: string | null;
  profilePath?: string | null;
};

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const oneLine = (v: string) => v.replace(/\s+/g, " ").trim();
const looksLikeEmail = (v: string | null | undefined): v is string => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

function adminBaseUrl(): string {
  return (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://reservations.tee24.golf").replace(/\/+$/, "");
}

const TOPIC_LABELS: Record<string, string> = {
  update_payment: "Update payment method",
  request_freeze: "Request to freeze membership",
  request_cancel: "Request to cancel membership",
  request_refund: "Request a refund",
  door_issue: "Door access not working",
  update_info: "Update my contact info",
};

/** Subject + HTML for the front-desk copy (exported for tests). */
export function buildMemberMessageCopy(input: MemberMessageCopyInput): { subject: string; html: string } {
  const name = oneLine(`${input.member.firstName} ${input.member.lastName}`) || "A member";
  const memberSubject = oneLine(input.subject ?? "");
  const subject = (memberSubject ? `Member message: ${memberSubject} — ${name}` : `Member message from ${name}`).slice(0, 200);

  const topic = input.topic && input.topic !== "general" ? TOPIC_LABELS[input.topic] ?? input.topic : null;
  const email = looksLikeEmail(input.member.email) ? input.member.email.trim() : null;
  const cell = "padding:8px 12px;border-bottom:1px solid #eee;";
  const row = (label: string, value: string) => `<tr><td style="${cell}font-weight:bold;white-space:nowrap;vertical-align:top;">${label}</td><td style="${cell}">${value}</td></tr>`;
  const rows = [
    row("Member", esc(name)),
    email ? row("Email", `<a href="mailto:${esc(email)}">${esc(email)}</a>`) : row("Email", "None on file"),
    input.member.phone ? row("Phone", `<a href="tel:${esc(input.member.phone)}">${esc(input.member.phone)}</a>`) : "",
    input.member.locationName ? row("Location", esc(input.member.locationName)) : "",
    topic ? row("Topic", esc(topic)) : "",
    memberSubject ? row("Subject", esc(memberSubject)) : "",
    row("Wants a reply by", input.replyBy === "SMS" ? "Text" : "Email"),
    row("Message", esc(input.body.trim()).replace(/\n/g, "<br>")),
  ].join("");

  const base = adminBaseUrl();
  const links = [
    input.conversationPath ? `<a href="${esc(base + input.conversationPath)}">Open in the admin Inbox</a>` : "",
    input.profilePath ? `<a href="${esc(base + input.profilePath)}">Member profile</a>` : "",
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  const html =
    `<h2 style="margin:0 0 12px;">New message from the member portal</h2>` +
    `<table style="border-collapse:collapse;width:100%;max-width:600px;">${rows}</table>` +
    (email
      ? `<p style="margin:16px 0 0;font-size:13px;color:#555;">Reply to this email to answer ${esc(name)} directly.</p>`
      : `<p style="margin:16px 0 0;font-size:13px;color:#555;">This member has no email on file — answer from the admin Inbox or by phone.</p>`) +
    (links ? `<p style="margin:8px 0 0;font-size:13px;">${links}</p>` : "");

  return { subject, html };
}

/**
 * Email the front-desk mailbox a copy of a member's portal message. Never
 * throws — the message is already saved, so a failed copy is logged, not fatal.
 */
export async function emailFrontDeskMemberMessage(input: MemberMessageCopyInput): Promise<{ ok: boolean; to: string; error?: string }> {
  const to = fallbackReplyTo();
  try {
    const { subject, html } = buildMemberMessageCopy(input);
    const res = await sendEmail({
      to,
      subject,
      html,
      // No email on file → replies stay in the mailbox rather than going to the admin-inbox address.
      replyTo: looksLikeEmail(input.member.email) ? input.member.email.trim() : to,
      ledger: false,
    });
    if (!res.ok) console.error("[front-desk-email] member message copy failed:", res.error);
    return { ok: res.ok, to, error: res.error };
  } catch (e) {
    const error = e instanceof Error ? e.message : "send threw";
    console.error("[front-desk-email] member message copy threw:", error);
    return { ok: false, to, error };
  }
}
