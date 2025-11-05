// app/api/debug/auth/ping/route.ts
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- HS256 verify (Node runtime Web Crypto) ---
function b64urlToUint8Array(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifyJwtHS256(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false as const, error: "bad-format" };
  const [h, p, s] = parts;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const sigOk = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlToUint8Array(s),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!sigOk) return { ok: false as const, error: "bad-signature" };

  try {
    const payload = JSON.parse(
      Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    const now = Math.floor(Date.now() / 1000);
    if (payload?.exp && now > payload.exp) {
      return { ok: false as const, error: "expired", payload };
    }
    return { ok: true as const, payload };
  } catch {
    return { ok: false as const, error: "bad-payload" };
  }
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get("ADMIN_SESSION")?.value;
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing-cookie" }, { status: 401 });
  }

  const secret = process.env.AUTH_SECRET || "dev-secret";
  const res = await verifyJwtHS256(token, secret);

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error, payload: res.payload ?? null }, { status: 401 });
  }

  return NextResponse.json({ ok: true, payload: res.payload }, { status: 200 });
}
