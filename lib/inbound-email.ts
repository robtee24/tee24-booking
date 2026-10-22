/**
 * Inbound email routing.
 *
 * Replies to anything we send should land in the inbox. We set a Reply-To on
 * every member-facing email pointing at the inbound domain (Resend Receiving):
 *
 *   EMAIL_REPLY_DOMAIN=reply.tee24.golf        (custom domain with Resend MX)
 *   EMAIL_REPLY_DOMAIN=xxxx.resend.app         (Resend-managed, no DNS needed)
 *
 * Plain replies go to `inbox@<domain>`; replies from an inbox thread use
 * `reply+<conversationId>@<domain>` so the answer threads back automatically.
 */

export function inboundReplyDomain(): string | null {
  const d = (process.env.EMAIL_REPLY_DOMAIN ?? "").trim().toLowerCase();
  return d || null;
}

export function defaultReplyTo(): string | null {
  const d = inboundReplyDomain();
  return d ? `inbox@${d}` : null;
}

export function threadReplyTo(conversationId: string): string | null {
  const d = inboundReplyDomain();
  return d ? `reply+${conversationId}@${d}` : null;
}

/** Pull a conversation id out of `reply+<id>@domain` (any recipient). */
export function parseReplyAddress(recipients: Array<string | null | undefined>): string | null {
  for (const r of recipients) {
    if (!r) continue;
    const m = r.toLowerCase().match(/^\s*(?:"?[^"<]*"?\s*<)?reply\+([a-z0-9_-]+)@/i);
    if (m) return m[1];
  }
  return null;
}

/** Strip a display name: `Jane <jane@x.com>` → `jane@x.com`. */
export function bareAddress(addr: string | null | undefined): string {
  if (!addr) return "";
  const m = addr.match(/<\s*([^>]+)\s*>/);
  return (m ? m[1] : addr).trim().toLowerCase();
}

/** Display name from `Jane Doe <jane@x.com>`, or null. */
export function displayName(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const m = addr.match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() || null : null;
}

/** Mailer-daemon / auto-responder noise we never want as a conversation. */
export function isAutomatedSender(from: string, headers?: Record<string, string> | null): boolean {
  const f = bareAddress(from);
  if (/^(mailer-daemon|postmaster|no-?reply|donotreply|bounce)[@+.-]/i.test(f)) return true;
  const auto = headers?.["auto-submitted"] ?? headers?.["Auto-Submitted"];
  if (auto && !/^no$/i.test(auto)) return true;
  const precedence = headers?.["precedence"] ?? headers?.["Precedence"];
  if (precedence && /^(bulk|junk|auto_reply|list)$/i.test(precedence)) return true;
  return false;
}

/** Best-effort: turn an HTML body into readable text for previews/SMS-style display. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Trim quoted history from a reply ("On ... wrote:", "-----Original Message-----",
 * gmail_quote blocks) so the thread shows only what the person typed.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+ wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^From:\s.+$/.test(line.trim()) && out.length > 0) break;
    if (/^>/.test(line.trim())) continue;
    out.push(line);
  }
  const result = out.join("\n").trim();
  return result || text.trim();
}
