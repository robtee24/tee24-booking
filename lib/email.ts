// lib/email.ts
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  cc?: string[];
  bcc?: string[];
  from?: string; // optional override
}) {
  const from = opts.from ?? 'Tee24 <notifications@tee24-mail.com>'; // use your verified sender
  const { data, error } = await resend.emails.send({
    from,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    cc: opts.cc,
    bcc: opts.bcc,
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
  return data?.id ?? null;
}
