// app/api/logout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies as asyncCookies } from "next/headers";

export const dynamic = "force-dynamic";

// Parse raw Cookie header (works even if next/headers doesn't expose cookies)
function parseCookieHeader(header: string | null): { name: string; value: string }[] {
  if (!header) return [];
  return header
    .split(";")
    .map((part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return { name: part.trim(), value: "" };
      const name = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      return { name, value };
    })
    .filter((c) => c.name.length > 0);
}

async function clearAll(req: NextRequest) {
  // 204 No Content is ideal for fetch-based logout
  const res = new NextResponse(null, { status: 204 });
  res.headers.set("Cache-Control", "no-store");

  const names = new Set<string>();

  // 1) Raw header
  for (const c of parseCookieHeader(req.headers.get("cookie"))) names.add(c.name);

  // 2) Next 16 async cookies() API (guarded)
  try {
    const ck = await asyncCookies();
    const list = (ck as any)?.getAll?.() ?? [];
    for (const c of list) names.add(c.name);
  } catch {
    // ignore if not available
  }

  // Clear with both "/" and "/admin" paths
  const paths = ["/", "/admin"];
  for (const name of names) {
    for (const path of paths) {
      res.cookies.set({
        name,
        value: "",
        path,
        httpOnly: true,
        sameSite: "lax",
        expires: new Date(0),
        maxAge: 0,
      });
    }
  }

  return res;
}

export async function POST(req: NextRequest) {
  return clearAll(req);
}
export async function GET(req: NextRequest) {
  return clearAll(req);
}

