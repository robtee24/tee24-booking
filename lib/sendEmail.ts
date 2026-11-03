// lib/sendEmail.ts
/**
 * Resend email sender with clear error surfacing.
 *
 * Env (either is accepted; RESEND_FROM is preferred):
 *   RESEND_API_KEY=re_...
 *   RESEND_FROM='Tee24 Reservations <reservations@tee24.golf>'
 *   FROM_EMAIL='Tee24 Reservations <reservations@tee24.golf>' // legacy fallback
 *   COMMS_DRY_RUN=1  → log instead of calling Resend (safe for local testing)
 */
import { Resend } from 'resend';
import { recordOutbound, type LedgerOption } from '@/lib/message-ledger';
import { defaultReplyTo } from '@/lib/inbound-email';
import { memberBaseUrl } from '@/lib/public-url';

type SendEmailResult = {
  ok: boolean;
  id?: string | null;
  error?: string;
  provider?: unknown; // raw provider response/error for debugging
  dryRun?: boolean;
};

export type EmailAttachment = { filename: string; path: string } | { filename: string; content: string };

export type SendEmailOptions = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  bcc?: string | string[];
  cc?: string | string[];
  replyTo?: string;
  /** URL-based attachments (Resend fetches `path`) or inline base64 `content`. */
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
  /**
   * Message-ledger hint. Every send is logged to `Message` by default; pass
   * `false` when the caller logs its own row or the body contains a secret.
   */
  ledger?: LedgerOption;
  /** Skip the Tee24 logo header (default: added to every email). */
  brand?: false;
};

/**
 * Every outbound email carries the Tee24 logo on a clubhouse-green band above
 * the body, so receipts, booking confirmations, welcome mail and campaigns all
 * look like they came from the same place. Idempotent: skipped when the body
 * already includes the logo.
 */
export function brandEmailHtml(html: string): string {
  if (/tee24-logo\.png/.test(html)) return html;
  const logo = `${memberBaseUrl()}/tee24-logo.png`;
  // Full HTML documents (e.g. POS receipts): drop the logo band in right after <body> instead of wrapping.
  if (/<body[\s>]/i.test(html)) {
    return html.replace(/(<body[^>]*>)/i, `$1<div style="background:#0b3d2e;padding:18px 24px;text-align:center;"><img src="${logo}" alt="Tee24 Indoor Golf Center" height="64" style="height:64px;width:auto;display:inline-block;" /></div>`);
  }
  return `<div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="background:#0b3d2e;border-radius:16px 16px 0 0;padding:18px 24px;text-align:center;">
    <img src="${logo}" alt="Tee24 Indoor Golf Center" height="64" style="height:64px;width:auto;display:inline-block;" />
  </div>
  <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 16px 16px;padding:20px 24px 24px;font-size:15px;line-height:1.5;color:#0f172a;">
${html}
  </div>
</div>`;
}

const API_KEY = process.env.RESEND_API_KEY || '';
// Prefer RESEND_FROM, fallback to FROM_EMAIL so confirmations & reminders behave the same
const FROM_HEADER = (process.env.RESEND_FROM || process.env.RESEND_FROM_EMAIL || process.env.FROM_EMAIL || '').trim();

let resend: Resend | null = null;
function getClient(): Resend {
  if (!resend) resend = new Resend(API_KEY);
  return resend;
}

function isValidFrom(s: string) {
  // Accept: "Name <email@domain>" or "email@domain"
  if (!s) return false;
  if (s.includes('<') && s.includes('>')) {
    const m = s.match(/<\s*([^>]+)\s*>/);
    return !!(m && m[1] && m[1].includes('@'));
  }
  return s.includes('@');
}

export function isEmailDryRun(): boolean {
  return process.env.COMMS_DRY_RUN === '1' || process.env.COMMS_DRY_RUN === 'true';
}

/**
 * Send an email. Accepts either the legacy positional form
 * `(to, subject, html)` or an options object with bcc / replyTo / attachments.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<SendEmailResult>;
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult>;
export async function sendEmail(
  toOrOpts: string | SendEmailOptions,
  subject?: string,
  html?: string
): Promise<SendEmailResult> {
  const opts: SendEmailOptions =
    typeof toOrOpts === 'string' ? { to: toOrOpts, subject: subject ?? '', html: html ?? '' } : toOrOpts;

  if (!opts.to) return { ok: false, error: 'Missing recipient' };

  const result = await sendEmailInner(opts);
  if (opts.ledger !== false) {
    await recordOutbound({
      channel: 'EMAIL',
      to: opts.to,
      subject: opts.subject,
      body: opts.html || opts.text || '',
      ok: result.ok,
      providerId: result.id ?? null,
      error: result.error ?? null,
      dryRun: result.dryRun,
      hint: opts.ledger ?? undefined,
    });
  }
  return result;
}

async function sendEmailInner(opts: SendEmailOptions): Promise<SendEmailResult> {
  if (isEmailDryRun()) {
    console.log('[sendEmail] DRY_RUN', { to: opts.to, subject: opts.subject, bcc: opts.bcc, replyTo: opts.replyTo, attachments: opts.attachments?.length ?? 0 });
    return { ok: true, id: `dry_${Date.now()}`, dryRun: true };
  }

  if (!API_KEY) return { ok: false, error: 'Missing RESEND_API_KEY' };
  if (!FROM_HEADER) return { ok: false, error: 'Missing RESEND_FROM / FROM_EMAIL' };
  if (!isValidFrom(FROM_HEADER))
    return { ok: false, error: `Invalid sender header: "${FROM_HEADER}"` };

  try {
    const client = getClient();
    const payload: Record<string, unknown> = {
      from: FROM_HEADER, // e.g., 'Tee24 Reservations <reservations@tee24.golf>'
      to: opts.to,
      subject: opts.subject,
      html: opts.brand === false ? opts.html : brandEmailHtml(opts.html),
    };
    if (opts.text) payload.text = opts.text;
    if (opts.bcc) payload.bcc = opts.bcc;
    if (opts.cc) payload.cc = opts.cc;
    // Replies should land in the inbox: default Reply-To to the inbound domain when configured.
    const replyTo = opts.replyTo ?? defaultReplyTo();
    if (replyTo) payload.replyTo = replyTo;
    if (opts.headers) payload.headers = opts.headers;
    if (opts.tags) payload.tags = opts.tags;
    if (opts.attachments?.length) payload.attachments = opts.attachments;

    const res = await client.emails.send(payload as any);

    // Resend v2 returns { data: { id }, error }
    const anyRes = res as any;
    if (anyRes?.error) {
      const msg = anyRes.error?.message || JSON.stringify(anyRes.error);
      return { ok: false, error: msg, provider: res };
    }

    const id = anyRes?.data?.id ?? anyRes?.id ?? null;
    return { ok: true, id, provider: res };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Email send threw',
      provider: e,
    };
  }
}
