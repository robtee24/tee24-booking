// Shared plumbing for /api/mobile/* — bearer-token auth + uniform JSON errors.
//
// Every mobile endpoint returns `{ ok: true, ... }` or
// `{ ok: false, error: string, code: string, ...extra }` so the app can key
// behaviour (session expired → sign-out, device mismatch → transfer modal,
// quota exceeded → upsell copy) off `code` rather than parsing messages.
import { NextRequest, NextResponse } from "next/server";
import { MobileAuthError, requireMobileAuth, type MobileAuth } from "@/lib/mobile-session";
import { MobileError } from "@/services/mobile-auth.service";
import { PortalError } from "@/services/portal.service";

export const mobileRouteConfig = { runtime: "nodejs" as const, dynamic: "force-dynamic" as const };

export function ok<T extends Record<string, unknown>>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...data }, init);
}

export function fail(message: string, status = 400, code = "BAD_REQUEST", extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, code, ...(extra ?? {}) }, { status });
}

export function handleError(err: unknown, label: string) {
  if (err instanceof MobileAuthError) return fail(err.message, err.status, err.code);
  if (err instanceof MobileError) return fail(err.message, err.status, err.code, err.extra);
  if (err instanceof PortalError) return fail(err.message, err.status, "PORTAL_ERROR");
  console.error(`[mobile/${label}]`, err);
  const msg = err instanceof Error ? err.message : "Something went wrong";
  return fail(msg, 500, "SERVER_ERROR");
}

type Handler<Ctx> = (req: NextRequest, auth: MobileAuth, ctx: Ctx) => Promise<NextResponse>;

/** Wrap a handler so it only runs with a valid mobile session. */
export function withMobileAuth<Ctx = unknown>(label: string, handler: Handler<Ctx>) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      const auth = await requireMobileAuth(req);
      return await handler(req, auth, ctx);
    } catch (err) {
      return handleError(err, label);
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  return (await req.json().catch(() => ({}))) as T;
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
