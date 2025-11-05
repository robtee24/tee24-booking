// lib/notify.ts
type EmailArgs = { to: string; subject: string; html: string };
type SMSArgs = { to: string; text: string };

// read with fallbacks (to match your existing reminder setup)
function env(...names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

// ---------- Email (Resend) ----------
export async function sendEmail({ to, subject, html }: EmailArgs): Promise<void> {
  const apiKey = env("RESEND_API_KEY");
  const from =
    env("RESEND_FROM", "RESEND_FROM_EMAIL", "RESEND_SENDER") || "no-reply@tee24.golf";

  if (!apiKey) {
    console.warn("[notify] Email skipped — missing RESEND_API_KEY");
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[notify] Resend email failed:", res.status, text);
    }
  } catch (err) {
    console.error("[notify] Resend email error:", err);
  }
}

// ---------- SMS (OpenPhone) ----------
export async function sendSMS(to: string, text: string): Promise<void>;
export async function sendSMS(args: SMSArgs): Promise<void>;
export async function sendSMS(a: string | SMSArgs, b?: string): Promise<void> {
  const apiKey = env("OPENPHONE_API_KEY", "OPENPHONE_TOKEN");
  const from = env("OPENPHONE_NUMBER", "OPENPHONE_FROM");

  if (!apiKey || !from) {
    console.warn("[notify] SMS skipped — missing OPENPHONE_API_KEY or OPENPHONE_NUMBER");
    return;
  }

  const payload: SMSArgs = typeof a === "string" ? { to: a, text: b ?? "" } : a;
  if (!payload.to || !payload.text) {
    console.warn("[notify] SMS skipped — missing 'to' or 'text'");
    return;
  }

  try {
    const res = await fetch("https://api.openphone.com/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: payload.to, text: payload.text }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[notify] OpenPhone SMS failed:", res.status, text);
    }
  } catch (err) {
    console.error("[notify] OpenPhone SMS error:", err);
  }
}

