import { NextRequest, NextResponse } from "next/server";
import { cookies as reqCookies } from "next/headers";

export const dynamic = "force-dynamic";

function clear(res: NextResponse, name: string) {
  // Clear on both "/" and "/admin" to match how it may have been set.
  for (const path of ["/", "/admin"]) {
    res.cookies.set({
      name,
      value: "",
      path,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 0,
    });
  }
}

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });

  // ✅ NEW: await the cookies() Promise
  const cookieStore = await reqCookies();
  const all = cookieStore.getAll();

  const known = new Set([
    "admin_auth",
    "admin_session",
    "admin_jwt",
    "admin_token",
    "auth",
    "session",
    "access_token",
    "refresh_token",
  ]);

  for (const c of all) {
    const n = c.name;
    const lower = n.toLowerCase();
    if (
      known.has(n) ||
      lower.startsWith("admin") ||
      lower.endsWith("_token") ||
      lower.endsWith("_session")
    ) {
      clear(res, n);
    }
  }

  return res;
}

// Optional GET support (handy for manual testing with a browser)
export async function GET(req: NextRequest) {
  const redirect = req.nextUrl.searchParams.get("redirect");
  const res = NextResponse.json({ ok: true });

  // ✅ NEW: await the cookies() Promise
  const cookieStore = await reqCookies();
  const all = cookieStore.getAll();

  for (const c of all) {
    const n = c.name;
    const lower = n.toLowerCase();
    if (
      lower.startsWith("admin") ||
      lower.endsWith("_token") ||
      lower.endsWith("_session") ||
      n === "auth" ||
      n === "session" ||
      n === "access_token" ||
      n === "refresh_token"
    ) {
      for (const path of ["/", "/admin"]) {
        res.cookies.set({
          name: n,
          value: "",
          path,
          httpOnly: true,
          sameSite: "lax",
          maxAge: 0,
        });
      }
    }
  }

  // You can optionally redirect client-side using the ?redirect param if desired.
  return res;
}
