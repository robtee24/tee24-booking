// Shared helpers for the members / memberships / family / front-desk API routes.
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { requireLocationAdminApi, type ApiAdmin } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { ForbiddenError, type ActorContext } from "@/lib/permissions";
import type { MemberQuery, MemberStatus } from "@/services/member.service";

export type MemberGuard =
  | { ok: true; admin: ApiAdmin; actor: ActorContext; member: MemberCore; location: { id: string; slug: string; name: string; organizationId: string | null; timezone: string; taxRateBps: number } }
  | { ok: false; response: NextResponse };

export type MemberCore = {
  id: string;
  locationId: string;
  organizationId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
};

export type LocationGuard =
  | { ok: true; admin: ApiAdmin; location: { id: string; slug: string; name: string } }
  | { ok: false; response: NextResponse };

/** Narrowing wrapper around requireLocationAdminApi (its `location` isn't typed as present on success). */
export async function requireLocationApi(ref: { locationId?: string | null; locationSlug?: string | null }): Promise<LocationGuard> {
  const guard = await requireLocationAdminApi(ref);
  if (!guard.ok) return { ok: false, response: guard.response };
  if (!guard.location) return { ok: false, response: NextResponse.json({ error: "Location not found" }, { status: 404 }) };
  return { ok: true, admin: guard.admin, location: guard.location };
}

/**
 * Load the member, resolve its location and run the location admin guard.
 * Use for every /api/admin/members/[id]/** handler.
 */
export async function requireMemberApi(memberId: string): Promise<MemberGuard> {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, locationId: true, organizationId: true, firstName: true, lastName: true, email: true, phone: true, status: true },
  });
  if (!member) return { ok: false, response: NextResponse.json({ error: "Member not found" }, { status: 404 }) };
  const guard = await requireLocationAdminApi({ locationId: member.locationId });
  if (!guard.ok) return { ok: false, response: guard.response };
  const actor = await getActorContext();
  if (!actor) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const location = await prisma.location.findUnique({
    where: { id: member.locationId },
    select: { id: true, slug: true, name: true, organizationId: true, timezone: true, taxRateBps: true },
  });
  if (!location) return { ok: false, response: NextResponse.json({ error: "Location not found" }, { status: 404 }) };
  return { ok: true, admin: guard.admin, actor, member, location };
}

/** Map thrown errors to JSON responses (403 for permission failures). */
export function apiError(e: unknown, fallbackStatus = 400): NextResponse {
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: `You don't have permission to do that (${e.permission}).` }, { status: 403 });
  }
  const message = e instanceof Error ? e.message : "Request failed";
  if (fallbackStatus >= 500) console.error("[api]", e);
  return NextResponse.json({ error: message }, { status: fallbackStatus });
}

export async function readJson<T = Record<string, any>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function parseDate(v: unknown): Date | undefined {
  if (v == null || v === "") return undefined;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function toCents(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

const STATUSES: MemberStatus[] = ["PENDING", "ACTIVE", "VISITOR", "FROZEN", "CANCELLED"];

/** Translate URL search params into a MemberQuery (shared by list, export and bulk routes). */
export function memberQueryFromParams(sp: URLSearchParams, locationId: string): MemberQuery {
  const list = (k: string) => sp.getAll(k).flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean);
  const bool = (k: string): boolean | undefined => {
    const v = sp.get(k);
    if (v == null || v === "" || v === "any") return undefined;
    return v === "1" || v === "true" || v === "yes";
  };
  const num = (k: string): number | undefined => {
    const v = sp.get(k);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const statusRaw = (sp.get("status") || "").toUpperCase();
  const status = statusRaw && statusRaw !== "ALL" ? (list("status").map((s) => s.toUpperCase()).filter((s) => STATUSES.includes(s as MemberStatus)) as MemberStatus[]) : undefined;
  const sortBy = (sp.get("sortBy") || sp.get("sort") || undefined) as MemberQuery["sortBy"];
  const sortDir = (sp.get("sortDir") || sp.get("dir") || undefined) as MemberQuery["sortDir"];
  return {
    locationId,
    status: status?.length ? status : undefined,
    search: (sp.get("search") || sp.get("q") || "").trim() || undefined,
    tagIds: list("tagIds").length ? list("tagIds") : undefined,
    planId: sp.get("planId") || undefined,
    joinedFrom: parseDate(sp.get("joinedFrom")),
    joinedTo: parseDate(sp.get("joinedTo")),
    membershipStartFrom: parseDate(sp.get("membershipStartFrom")),
    membershipStartTo: parseDate(sp.get("membershipStartTo")),
    membershipEndFrom: parseDate(sp.get("membershipEndFrom")),
    membershipEndTo: parseDate(sp.get("membershipEndTo")),
    birthMonth: num("birthMonth"),
    gender: sp.get("gender") || undefined,
    minAge: num("minAge"),
    maxAge: num("maxAge"),
    lastVisitBefore: parseDate(sp.get("lastVisitBefore")),
    lastVisitAfter: parseDate(sp.get("lastVisitAfter")),
    hasCard: bool("hasCard"),
    missingRequiredDoc: bool("missingRequiredDoc"),
    emailOptIn: bool("emailOptIn"),
    smsOptIn: bool("smsOptIn"),
    sortBy: sortBy && ["name", "joinDate", "lastVisit", "age"].includes(sortBy) ? sortBy : undefined,
    sortDir: sortDir === "asc" || sortDir === "desc" ? sortDir : undefined,
    page: num("page"),
    pageSize: num("pageSize") ?? num("limit"),
  };
}
