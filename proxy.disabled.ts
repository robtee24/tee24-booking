// proxy.ts
import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth gate for /admin pages and /api/admin routes using an HS256 JWT cookie.
 * - Unauthed /admin/*       -> redirect to /admin/login?next=...
 * - Unauthed /api/admin/*   -> 401 JSON
 *
 * Public (no token required):
 * - /admin/login, /admin/auth/*
 * - /api/admin/auth/*, /api/debug/auth/*
 *
 * Requires: ADMIN_JWT_SECRET in .env.local
 * Cookie default: "admin_jwt" (edit ADMIN_COOKIE_CANDIDATES if needed)
 */

// -------- Settings --------
const ADMIN_COOKIE_CANDIDATES = ["admin_jwt", "admin_session", "tee24_admin", "session"];

const PUBLIC_ADMIN_PAGES = [
  "/admin/login",
  "/admin/auth/start",
  "/admin/auth/verify",
  "/admin/auth/callback",
];

const PUBLIC_ADMIN_APIS = [
  "/api/admin/auth/start",
  "/api/admin/auth/verify",
  "/api/admin/auth/callback",
  "/api/debug/auth/ping", // optional debug endpoint
];

// -------- Helpers --------
function b64urlToUint8Array(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function parseJwtPayload(token: string): any | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function verifyJwtHS256(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [header, payload, signature] = parts;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlToUint8Array(signature),
    enc.encode(`${header}.${payload}`)
  );
  if (!ok) return false;

  const data = parseJwtPayload(token);
  if (!data) return false;
  if (typeof data.exp === "number" && Date.now() / 1000 >= data.exp) return false;

  return true;
}

function getAdminToken(req: NextRequest): string | null {
  for (const name of ADMIN_COOKIE_CANDIDATES) {
    const v = req.cookies.get(name)?.value;
    if (v) return v;
  }
  return null;
}

function isPublic(pathname: string) {
  return (
    PUBLIC_ADMIN_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    PUBLIC_ADMIN_APIS.some((p) => pathname === p || pathname.startsWith(p + "/"))
  );
}

// -------- Proxy function --------
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isAdminPage = pathname.startsWith("/admin");
  const isAdminAPI = pathname.startsWith("/api/admin");

  if (!isAdminPage && !isAdminAPI) {
    return NextResponse.next();
  }

  // Allow public admin pages & APIs (login/auth flows, debug ping)
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const token = getAdminToken(req);
  const secret = process.env.ADMIN_JWT_SECRET || "";

  if (!token || !secret) {
    if (isAdminAPI) {
      return new NextResponse(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  try {
    const ok = await verifyJwtHS256(token, secret);
    if (!ok) {
      if (isAdminAPI) {
        return new NextResponse(JSON.stringify({ ok: false, error: "invalid-token" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  } catch {
    if (isAdminAPI) {
      return new NextResponse(JSON.stringify({ ok: false, error: "auth-check-failed" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Scope to admin pages/APIs
export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};


