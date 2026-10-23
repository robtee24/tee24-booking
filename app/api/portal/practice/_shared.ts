// Shared plumbing for /api/portal/practice/* and /api/portal/swing/* — the
// clubhouse (web) twin of /api/mobile/practice. Same services, same response
// shape ({ ok, ... } / { ok: false, error, code }), but authenticated with the
// member-session cookie instead of a mobile bearer token.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember, getMemberSession } from "@/lib/member-session";
import { MobileError } from "@/services/mobile-auth.service";
import { PortalError } from "@/services/portal.service";

export const portalRouteConfig = { runtime: "nodejs" as const, dynamic: "force-dynamic" as const };

export type PortalAuth = { memberId: string; impersonated: boolean };

export function ok<T extends Record<string, unknown>>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...data }, init);
}

export function fail(message: string, status = 400, code = "BAD_REQUEST", extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, code, ...(extra ?? {}) }, { status });
}

type Handler<Ctx> = (req: NextRequest, auth: PortalAuth, ctx: Ctx) => Promise<NextResponse>;

/**
 * Run a handler for the signed-in member. `write: true` blocks impersonated
 * (staff "view as member") sessions so staff can look but not change data.
 */
export function withPortalMember<Ctx = unknown>(label: string, handler: Handler<Ctx>, opts: { write?: boolean } = {}) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      const [member, session] = await Promise.all([getCurrentMember(), getMemberSession()]);
      if (!member) return fail("Unauthorized", 401, "UNAUTHORIZED");
      const impersonated = session?.role === "IMPERSONATED";
      if (opts.write && impersonated) return fail("Read-only while viewing as member", 403, "READ_ONLY");
      return await handler(req, { memberId: member.id, impersonated }, ctx);
    } catch (err) {
      if (err instanceof MobileError) return fail(err.message, err.status, err.code, err.extra);
      if (err instanceof PortalError) return fail(err.message, err.status, "PORTAL_ERROR");
      console.error(`[portal/${label}]`, err);
      return fail(err instanceof Error ? err.message : "Something went wrong", 500, "SERVER_ERROR");
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  return (await req.json().catch(() => ({}))) as T;
}
