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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
