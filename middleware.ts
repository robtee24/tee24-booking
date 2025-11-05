// middleware.ts
import { NextRequest, NextResponse } from "next/server";

/**
 * Guard /admin/* pages and /api/admin/* routes.
 * BUT allow the auth endpoints so login texts/codes can be sent and verified.
 */

const COOKIE_NAMES = [
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

// Paths that should NOT be guarded (public for login flow + static)
function isAllowlisted(pathname: string) {
  // Admin login page + logout route
  if (pathname === "/admin/login" || pathname === "/admin/logout") return true;

  // Admin auth APIs (START + VERIFY)
  if (pathname.startsWith("/api/admin/auth/")) return true;

  // Debug pings you used earlier (optional, keep if you still use them)
  if (pathname.startsWith("/api/debug/openphone/")) return true;

  // Static-ish assets under /admin (icons/manifest)
  if (
    pathname.startsWith("/admin/_next") ||
    pathname.startsWith("/admin/assets") ||
    pathname.startsWith("/admin/favicon") ||
    pathname.startsWith("/admin/manifest")
  ) {
    return true;
  }

  return false;
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
  ],
};

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public auth endpoints and admin login page
  if (isAllowlisted(pathname)) {
    return NextResponse.next();
  }

  // Only guard /admin/* pages and /api/admin/* routes (matcher already scoped)
  const cookieHeader = req.headers.get("cookie") || "";
  const isAuthed = COOKIE_NAMES.some((name) =>
    new RegExp(`(?:^|;\\s*)${name}=`).test(cookieHeader)
  );

  if (!isAuthed) {
    // For API calls, return 401 JSON. For pages, redirect to /admin/login.
    if (pathname.startsWith("/api/")) {
      return new NextResponse(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

