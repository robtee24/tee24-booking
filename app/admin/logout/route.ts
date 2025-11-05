// app/api/logout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies as asyncCookies } from "next/headers";

export const dynamic = "force-dynamic";

const KNOWN_AUTH_COOKIES = [
  "tee24_admin",
  "tee24_admin_token",
  "tee24_auth",
  "admin_token",
  "adminSession",
  "admin_session",
  "admin_jwt",
  "session",
  "auth",
  "jwt",
  "token",
];

function parseCookieHeader(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=");
      return (i === -1 ? p : p.slice(0, i)).trim();
    })
    .filter((name) => name.length > 0);
}

function domainVariants(hostname: string | null) {
  const out = [undefined as string | undefined];
  if (!hostname) return out;
  out.push(hostname);
  if (!hostname.startsWith(".")) out.push("." + hostname);
  return out;
}

async function clearAll(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  res.headers.set("Clear-Site-Data", '"cookies"');
  res.headers.set("Cache-Control", "no-store");

  const names = new Set<string>();
  for (const n of parseCookieHeader(req.headers.get("cookie"))) names.add(n);

  try {
    const ck = await asyncCookies();
    const list = (ck as any)?.getAll?.() ?? [];
    for (const c of list) names.add(c.name);
  } catch {
    // ignore
  }

  for (const n of KNOWN_AUTH_COOKIES) names.add(n);

  const paths = ["/", "/admin"];
  const domains = domainVariants(req.nextUrl.hostname);

  for (const name of names) {
    for (const path of paths) {
      for (const domain of domains) {
        res.cookies.set({
          name,
          value: "",
          path,
          domain,
          httpOnly: true,
          sameSite: "lax",
          expires: new Date(0),
          maxAge: 0,
          secure: req.nextUrl.protocol === "https:",
        });
      }
    }
  }

  return res;
}

export async function GET(req: NextRequest) {
  return clearAll(req);
}
export async function POST(req: NextRequest) {
  return clearAll(req);
}
