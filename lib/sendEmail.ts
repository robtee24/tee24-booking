// lib/sendEmail.ts
/**
 * Resend email sender with clear error surfacing.
 *
 * Env (either is accepted; RESEND_FROM is preferred):
 *   RESEND_API_KEY=re_...
 *   RESEND_FROM='Tee24 Reservations <reservations@tee24.golf>'
 *   FROM_EMAIL='Tee24 Reservations <reservations@tee24.golf>' // legacy fallback
 */
import { Resend } from 'resend';

type SendEmailResult = {
  ok: boolean;
  id?: string | null;
  error?: string;
  provider?: any; // raw provider response/error for debugging
};

const API_KEY = process.env.RESEND_API_KEY || '';
// Prefer RESEND_FROM, fallback to FROM_EMAIL so confirmations & reminders behave the same
const FROM_HEADER = (process.env.RESEND_FROM || process.env.FROM_EMAIL || '').trim();

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

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<SendEmailResult> {
  if (!API_KEY) return { ok: false, error: 'Missing RESEND_API_KEY' };
  if (!FROM_HEADER) return { ok: false, error: 'Missing RESEND_FROM / FROM_EMAIL' };
  if (!isValidFrom(FROM_HEADER))
    return { ok: false, error: `Invalid sender header: "${FROM_HEADER}"` };

  try {
    const client = getClient();
    const res = await client.emails.send({
      from: FROM_HEADER, // e.g., 'Tee24 Reservations <reservations@tee24.golf>'
      to,
      subject,
      html,
    });

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
