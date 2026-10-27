// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_PAGE_PATHS = /^\/admin(\/.*)?$/;
const ADMIN_API_PATHS = /^\/api\/admin(\/.*)?$/;
const PUBLIC_ADMIN_PATHS = new Set([
  "/admin/login",
  // Login/session endpoints must be reachable without a session.
  "/api/admin/auth/start",
  "/api/admin/auth/verify",
  "/api/admin/auth/2fa/login-verify",
  "/api/admin/auth/session",
  "/api/admin/auth/logout",
  // Dev ping; authenticates itself with CRON_SECRET.
  "/api/admin/admins/ping",
]);

// Member-facing pages live on the clubhouse host once MEMBER_BASE_URL is set
// (e.g. https://clubhouse.tee24.golf). Requests for those pages that arrive on
// another host (reservations.tee24.golf, *.vercel.app) are redirected so the
// address bar, cookies and shared links all agree. API routes are untouched.
const MEMBER_PATHS = /^\/(signup|signup-staging|daypass|pay|sign|portal)(\/.*)?$/;

function memberHostRedirect(request: NextRequest): NextResponse | null {
  const target = (process.env.MEMBER_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!target) return null;
  const { pathname } = request.nextUrl;
  if (!MEMBER_PATHS.test(pathname)) return null;
  let targetHost: string;
  try {
    targetHost = new URL(target).host;
  } catch {
    return null;
  }
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  if (!host || host === targetHost || host.startsWith("localhost") || host.startsWith("127.0.0.1")) return null;
  const url = new URL(`${target}${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url, 308);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hop = memberHostRedirect(request);
  if (hop) return hop;

  if (PUBLIC_ADMIN_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const isApi = ADMIN_API_PATHS.test(pathname);
  if (!isApi && !ADMIN_PAGE_PATHS.test(pathname)) {
    return NextResponse.next();
  }

  // Call session API route (Node.js runtime)
  const sessionRes = await fetch(
    new URL("/api/admin/auth/session", request.url).toString(),
    {
      method: "GET",
      headers: {
        cookie: request.headers.get("cookie") || "",
      },
    }
  );

  if (!sessionRes.ok) {
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const session = await sessionRes.json();

  const response = NextResponse.next();
  response.headers.set("x-admin-id", session.id);
  response.headers.set("x-admin-role", session.role);
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/signup/:path*", "/signup-staging/:path*", "/daypass/:path*", "/pay/:path*", "/sign/:path*", "/portal/:path*"],
};
