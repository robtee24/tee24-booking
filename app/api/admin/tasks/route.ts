// /api/admin/tasks — staff tasks (CRM follow-ups, ops to-dos).
//   GET    ?assignee=me|unassigned|all|<adminId>&status=open|done|all&due=overdue|today|week|all&locationId=&memberId=&q=
//   POST   { title, body?, assignedToId?, locationId?, memberId?, priority?, dueAt? }
//   PATCH  { id, ...any of title/body/assignedToId/locationId/memberId/priority/dueAt/status }
//   DELETE ?id=   (or body { id })
// Any admin may read/complete tasks they can see; creating/editing/deleting
// requires `ops.tasks` (ROOT/FULL implicit). SCOPED admins only see tasks at
// their locations or assigned to them.
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan, ForbiddenError } from "@/lib/permissions";
import { isFullAccess } from "@/lib/access";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASK_INCLUDE = {
  assignee: { select: { id: true, name: true, phone: true } },
  location: { select: { id: true, name: true, slug: true } },
} as const;

type ApiAdmin = { id: string; role: "ROOT" | "FULL" | "SCOPED"; locations: { locationId: string }[] };

function visibilityWhere(admin: ApiAdmin): Prisma.TaskWhereInput {
  if (isFullAccess(admin.role)) return {};
  return { OR: [{ assignedToId: admin.id }, { createdById: admin.id }, { locationId: { in: admin.locations.map((l) => l.locationId) } }] };
}

/** Member names are denormalised onto the response so the UI can show a chip without another query. */
async function attachMembers<T extends { memberId: string | null }>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.memberId).filter((x): x is string => !!x))];
  if (ids.length === 0) return rows.map((r) => ({ ...r, member: null as null | { id: string; firstName: string; lastName: string; phone: string; locationSlug: string } }));
  const members = await getPrisma().member.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true, phone: true, location: { select: { slug: true } } },
  });
  const map = new Map(members.map((m) => [m.id, { id: m.id, firstName: m.firstName, lastName: m.lastName, phone: m.phone, locationSlug: m.location.slug }]));
  return rows.map((r) => ({ ...r, member: r.memberId ? map.get(r.memberId) ?? null : null }));
}

function fail(err: unknown) {
  if (err instanceof ForbiddenError) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const msg = err instanceof Error ? err.message : "Server error";
  const known = /required|invalid|not found|cannot/i.test(msg);
  if (!known) console.error("[tasks]", err);
  return NextResponse.json({ ok: false, error: msg }, { status: known ? 400 : 500 });
}

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const admin = guard.admin as ApiAdmin;
  const sp = req.nextUrl.searchParams;
  const assignee = sp.get("assignee") ?? "me";
  const status = sp.get("status") ?? "open";
  const due = sp.get("due") ?? "all";
  const locationId = sp.get("locationId") || undefined;
  const memberId = sp.get("memberId") || undefined;
  const q = sp.get("q")?.trim() || undefined;
  const take = Math.min(500, Math.max(1, Number(sp.get("limit") ?? 200) || 200));

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const weekEnd = new Date(dayStart.getTime() + 7 * 86_400_000);

  const where: Prisma.TaskWhereInput = {
    AND: [
      visibilityWhere(admin),
      assignee === "me" ? { assignedToId: admin.id } : assignee === "unassigned" ? { assignedToId: null } : assignee === "all" ? {} : { assignedToId: assignee },
      status === "open" ? { status: { in: ["OPEN", "IN_PROGRESS"] } } : status === "done" ? { status: { in: ["DONE", "CANCELLED"] } } : {},
      due === "overdue" ? { dueAt: { lt: now }, status: { in: ["OPEN", "IN_PROGRESS"] } } : due === "today" ? { dueAt: { gte: dayStart, lt: dayEnd } } : due === "week" ? { dueAt: { gte: dayStart, lt: weekEnd } } : due === "none" ? { dueAt: null } : {},
      locationId ? { locationId } : {},
      memberId ? { memberId } : {},
      q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }] } : {},
    ],
  };

  const rows = await getPrisma().task.findMany({
    where,
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take,
    include: TASK_INCLUDE,
  });
  return NextResponse.json({ ok: true, tasks: await attachMembers(rows) });
}

function parseDue(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new Error("Due date is invalid");
  return d;
}

const PRIORITIES = new Set(["LOW", "NORMAL", "HIGH", "URGENT"]);
const STATUSES = new Set(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]);

export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  try {
    const body = await req.json().catch(() => ({}));
    const locationId = body.locationId ? String(body.locationId) : null;
    assertCan(await getActorContext(), "ops.tasks", locationId ? { locationId } : undefined);
    const title = String(body.title ?? "").trim();
    if (!title) throw new Error("Title is required");
    const priority = String(body.priority ?? "NORMAL").toUpperCase();
    const task = await getPrisma().task.create({
      data: {
        title: title.slice(0, 200),
        body: body.body ? String(body.body).slice(0, 4000) : null,
        assignedToId: body.assignedToId ? String(body.assignedToId) : null,
        locationId,
        memberId: body.memberId ? String(body.memberId) : null,
        priority: PRIORITIES.has(priority) ? priority : "NORMAL",
        dueAt: parseDue(body.dueAt),
        createdById: guard.admin.id,
      },
      include: TASK_INCLUDE,
    });
    void audit({ actorId: guard.admin.id, action: "settings.update", entityType: "Task", entityId: task.id, after: { title: task.title, assignedToId: task.assignedToId, dueAt: task.dueAt }, metadata: { op: "task.create", locationId } });
    const [withMember] = await attachMembers([task]);
    return NextResponse.json({ ok: true, task: withMember }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const admin = guard.admin as ApiAdmin;
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body.id ?? "");
    if (!id) throw new Error("id is required");
    const prisma = getPrisma();
    const existing = await prisma.task.findFirst({ where: { id, ...visibilityWhere(admin) } });
    if (!existing) return NextResponse.json({ ok: false, error: "Task not found" }, { status: 404 });

    const data: Prisma.TaskUncheckedUpdateInput = {};
    const onlyStatus = Object.keys(body).every((k) => k === "id" || k === "status");
    // Anyone who can see a task may complete/reopen it; everything else needs ops.tasks.
    if (!onlyStatus || !(existing.assignedToId === admin.id || existing.createdById === admin.id)) {
      assertCan(await getActorContext(), "ops.tasks", existing.locationId ? { locationId: existing.locationId } : undefined);
    }

    if (body.status !== undefined) {
      const s = String(body.status).toUpperCase();
      if (!STATUSES.has(s)) throw new Error("Status is invalid");
      data.status = s;
      data.completedAt = s === "DONE" ? new Date() : null;
    }
    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (!t) throw new Error("Title cannot be empty");
      data.title = t.slice(0, 200);
    }
    if (body.body !== undefined) data.body = body.body ? String(body.body).slice(0, 4000) : null;
    if (body.assignedToId !== undefined) data.assignedToId = body.assignedToId ? String(body.assignedToId) : null;
    if (body.locationId !== undefined) data.locationId = body.locationId ? String(body.locationId) : null;
    if (body.memberId !== undefined) data.memberId = body.memberId ? String(body.memberId) : null;
    if (body.priority !== undefined) {
      const p = String(body.priority).toUpperCase();
      if (!PRIORITIES.has(p)) throw new Error("Priority is invalid");
      data.priority = p;
    }
    if (body.dueAt !== undefined) data.dueAt = parseDue(body.dueAt);

    const task = await prisma.task.update({ where: { id }, data, include: TASK_INCLUDE });
    void audit({
      actorId: admin.id,
      action: "settings.update",
      entityType: "Task",
      entityId: id,
      before: { title: existing.title, status: existing.status, assignedToId: existing.assignedToId, dueAt: existing.dueAt, memberId: existing.memberId },
      after: { title: task.title, status: task.status, assignedToId: task.assignedToId, dueAt: task.dueAt, memberId: task.memberId },
      metadata: { op: "task.update", locationId: task.locationId },
    });
    const [withMember] = await attachMembers([task]);
    return NextResponse.json({ ok: true, task: withMember });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const admin = guard.admin as ApiAdmin;
  try {
    const id = req.nextUrl.searchParams.get("id") || String((await req.json().catch(() => ({})))?.id ?? "");
    if (!id) throw new Error("id is required");
    const prisma = getPrisma();
    const existing = await prisma.task.findFirst({ where: { id, ...visibilityWhere(admin) } });
    if (!existing) return NextResponse.json({ ok: false, error: "Task not found" }, { status: 404 });
    assertCan(await getActorContext(), "ops.tasks", existing.locationId ? { locationId: existing.locationId } : undefined);
    await prisma.task.delete({ where: { id } });
    void audit({ actorId: admin.id, action: "settings.update", entityType: "Task", entityId: id, before: { title: existing.title, status: existing.status }, metadata: { op: "task.delete", locationId: existing.locationId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
