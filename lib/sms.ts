// lib/sms.ts
const OPENPHONE_API_BASE = 'https://api.openphone.com/v1';

export async function sendSms(toE164: string, text: string) {
  const apiKey = process.env.OPENPHONE_API_KEY;
  const from = process.env.OPENPHONE_FROM; // your OpenPhone number in E.164
  if (!apiKey) throw new Error('Missing OPENPHONE_API_KEY');
  if (!from) throw new Error('Missing OPENPHONE_FROM');

  const res = await fetch(`${OPENPHONE_API_BASE}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,        // E.164
      to: [toE164],
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenPhone SMS failed: ${res.status} ${body}`);
  }
  return true;
}
