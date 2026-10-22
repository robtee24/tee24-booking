/**
 * Website contact-form intake (tee24.golf → here).
 *
 * The marketing site's own `/api/contact` emails the submission via Resend
 * and then forwards it here (server-to-server) so it also lands in the Inbox
 * and is attached to the member or lead. Authenticated with a shared secret:
 *   Authorization: Bearer <WEBSITE_CONTACT_SECRET>
 *
 * Browser form posts (JSON or form-encoded) are also accepted *without* the
 * secret when WEBSITE_CONTACT_ALLOW_BROWSER=1, guarded by CORS allow-list,
 * honeypot and a per-IP rate limit — useful as a fallback if the site ever
 * posts directly.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ingestWebsiteContact } from "@/services/inbox.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = new Set(["https://tee24.golf", "https://www.tee24.golf", ...(process.env.WEBSITE_CONTACT_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

function secretOk(req: NextRequest): boolean {
  const expected = process.env.WEBSITE_CONTACT_SECRET;
  if (!expected) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!got || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// Best-effort per-instance limiter (serverless instances are short-lived; this just blunts bursts).
const hits = new Map<string, number[]>();
function rateLimited(ip: string, limit = 8, windowMs = 10 * 60_000): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > limit;
}

async function readBody(req: NextRequest): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v == null ? "" : String(v)]));
  }
  const fd = await req.formData().catch(() => null);
  if (!fd) return {};
  const out: Record<string, string> = {};
  fd.forEach((v, k) => { out[k] = typeof v === "string" ? v : ""; });
  return out;
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const trusted = secretOk(req);
  const browserAllowed = process.env.WEBSITE_CONTACT_ALLOW_BROWSER === "1" && !!origin && ALLOWED_ORIGINS.has(origin);
  if (!trusted && !browserAllowed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: cors });
  }

  const body = await readBody(req);
  // Honeypot: real users never fill these.
  if (body._gotcha || body.website || body.company_url) {
    return NextResponse.json({ ok: true }, { status: 200, headers: cors });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  if (!trusted && rateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: cors });
  }

  const name = (body.name ?? `${body.firstName ?? ""} ${body.lastName ?? ""}`).trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const message = (body.message ?? "").trim();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message) {
    return NextResponse.json({ error: "name, email and message are required" }, { status: 400, headers: cors });
  }
  if (message.length > 10_000) {
    return NextResponse.json({ error: "message too long" }, { status: 413, headers: cors });
  }

  try {
    const res = await ingestWebsiteContact({
      name,
      email,
      phone: body.phone?.trim() || null,
      location: body.location?.trim() || null,
      subject: body.subject?.trim() || null,
      message,
      page: body.page?.trim() || req.headers.get("referer") || null,
      submissionId: body.submissionId?.trim() || null,
      submittedAt: body.submittedAt ? new Date(body.submittedAt) : undefined,
    });
    // Plain HTML form fallback: redirect back to the site.
    const accept = req.headers.get("accept") ?? "";
    if (!accept.includes("application/json") && body.redirect && /^https:\/\/(www\.)?tee24\.golf\//.test(body.redirect)) {
      return NextResponse.redirect(body.redirect, { status: 303 });
    }
    return NextResponse.json({ ok: true, ...res }, { status: 200, headers: cors });
  } catch (e) {
    console.error("[public/contact] ingest failed", e);
    return NextResponse.json({ error: "Could not record message" }, { status: 500, headers: cors });
  }
}
