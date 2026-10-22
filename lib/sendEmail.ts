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

type SendEmailResult = {
  ok: boolean;
  id?: string | null;
  error?: string;
  provider?: any; // raw provider response/error for debugging
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
};

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
      html: opts.html,
    };
    if (opts.text) payload.text = opts.text;
    if (opts.bcc) payload.bcc = opts.bcc;
    if (opts.cc) payload.cc = opts.cc;
    if (opts.replyTo) payload.replyTo = opts.replyTo;
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
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || 'Email send threw',
      provider: e,
    };
  }
}
