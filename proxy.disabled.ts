// middleware.ts
import { NextResponse, type NextRequest } from "next/server";

// Only run on /admin paths
export const config = { matcher: ["/admin/:path*"] };

export function middleware(req: NextRequest) {
  try {
    const url = req.nextUrl;

    // allow login itself through
    if (url.pathname.startsWith("/admin/login")) return NextResponse.next();

    // look for any of your likely cookies (don’t import next/headers in middleware)
    const c =
      req.cookies.get("admin_auth") ||
      req.cookies.get("admin_session") ||
      req.cookies.get("admin_jwt") ||
      req.cookies.get("admin_token");

    if (!c) {
      const login = new URL("/admin/login", url);
      login.searchParams.set("next", url.pathname + url.search);
      return NextResponse.redirect(login);
    }

    return NextResponse.next();
  } catch {
    // absolutely never crash in middleware
    return NextResponse.next();
  }
}

