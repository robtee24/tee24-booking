// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_PATHS = /^\/admin(\/.*)?$/;
const PUBLIC_ADMIN_PATHS = ["/admin/login"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_ADMIN_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  if (!ADMIN_PATHS.test(pathname)) {
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
  matcher: "/admin/:path*",
};