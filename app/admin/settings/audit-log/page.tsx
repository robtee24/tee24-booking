import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { adminRoutes } from "@/lib/admin/routes";
import { Button, Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { History, ChevronLeft, ChevronRight } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { AuditDetail } from "./AuditDetail";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SP = Record<string, string | undefined>;

function qs(base: SP, patch: SP) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return `${adminRoutes.settingsAuditLog()}${s ? `?${s}` : ""}`;
}

function parseDate(s: string | undefined, endOfDay = false): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return null;
  const sp = await searchParams;
  const prisma = getPrisma();
  const full = isFullAccess(admin.role);

  const action = sp.action?.trim() || undefined;
  const entityType = sp.entityType?.trim() || undefined;
  const actorId = sp.actorId?.trim() || undefined;
  const q = sp.q?.trim() || undefined;
  const from = parseDate(sp.from);
  const to = parseDate(sp.to, true);
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  // ── Scoping ──────────────────────────────────────────────────────────────
  // AuditLog has no locationId column, so SCOPED admins see entries that were
  // either performed by a colleague who shares one of their locations, or
  // tagged with one of their locations in metadata.locationId.
  const myLocationIds = admin.locations.map((l) => l.locationId);
  let scopeWhere: Prisma.AuditLogWhereInput = {};
  let actorOptions: { id: string; label: string }[] = [];
  if (full) {
    const admins = await prisma.admin.findMany({ select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } });
    actorOptions = admins.map((a) => ({ id: a.id, label: a.name || a.phone }));
  } else {
    const colleagues = await prisma.admin.findMany({
      where: { OR: [{ id: admin.id }, { locations: { some: { locationId: { in: myLocationIds } } } }] },
      select: { id: true, name: true, phone: true },
      orderBy: { name: "asc" },
    });
    actorOptions = colleagues.map((a) => ({ id: a.id, label: a.name || a.phone }));
    scopeWhere = {
      OR: [
        { actorId: { in: colleagues.map((c) => c.id) } },
        ...myLocationIds.map((id) => ({ metadata: { path: ["locationId"], equals: id } }) as Prisma.AuditLogWhereInput),
      ],
    };
  }

  const where: Prisma.AuditLogWhereInput = {
    AND: [
      scopeWhere,
      action ? { action } : {},
      entityType ? { entityType } : {},
      actorId ? { actorId } : {},
      from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {},
      q ? { OR: [{ entityId: { contains: q } }, { action: { contains: q, mode: "insensitive" } }, { entityType: { contains: q, mode: "insensitive" } }] } : {},
    ],
  };

  const [entries, total, actionRows, entityRows] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { actor: { select: { name: true, phone: true } } },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where: scopeWhere, distinct: ["action"], select: { action: true }, orderBy: { action: "asc" }, take: 300 }),
    prisma.auditLog.findMany({ where: scopeWhere, distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" }, take: 100 }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(action || entityType || actorId || q || sp.from || sp.to);
  const base: SP = { action, entityType, actorId, q, from: sp.from, to: sp.to };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every sensitive action across billing, members, staff, integrations, and settings."
        meta={<span className="text-apple-xs text-apple-text-tertiary">{total.toLocaleString()} {total === 1 ? "entry" : "entries"}{hasFilters ? " match" : ""}</span>}
      />

      <Card>
        <form method="get" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <label className="block">
            <span className="mb-1 block text-apple-xs font-medium text-apple-text-secondary">Action</span>
            <select name="action" defaultValue={action ?? ""} className="input w-full">
              <option value="">All actions</option>
              {actionRows.map((r) => <option key={r.action} value={r.action}>{r.action}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-apple-xs font-medium text-apple-text-secondary">Entity type</span>
            <select name="entityType" defaultValue={entityType ?? ""} className="input w-full">
              <option value="">All types</option>
              {entityRows.map((r) => <option key={r.entityType} value={r.entityType}>{r.entityType}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-apple-xs font-medium text-apple-text-secondary">Actor</span>
            <select name="actorId" defaultValue={actorId ?? ""} className="input w-full">
              <option value="">Anyone</option>
              {actorOptions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-apple-xs font-medium text-apple-text-secondary">From</span>
            <input type="date" name="from" defaultValue={sp.from ?? ""} className="input w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-apple-xs font-medium text-apple-text-secondary">To</span>
            <input type="date" name="to" defaultValue={sp.to ?? ""} className="input w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-apple-xs font-medium text-apple-text-secondary">Entity ID / search</span>
            <input type="search" name="q" defaultValue={q ?? ""} placeholder="cm9…" className="input w-full font-mono" />
          </label>
          <div className="col-span-2 flex items-center gap-2 md:col-span-3 lg:col-span-6">
            <Button type="submit" size="sm">Apply filters</Button>
            {hasFilters && (
              <Link href={adminRoutes.settingsAuditLog()} className="text-apple-sm text-apple-text-secondary hover:text-apple-text">
                Clear
              </Link>
            )}
          </div>
        </form>
      </Card>

      <Card padded={false}>
        {entries.length === 0 ? (
          <EmptyState icon={<History className="h-6 w-6" />} title={hasFilters ? "No entries match these filters" : "Nothing logged yet"} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-apple-sm">
              <thead className="border-b border-apple-divider bg-apple-fill-secondary text-apple-xs uppercase text-apple-text-tertiary">
                <tr>
                  <th className="px-4 py-3 text-left">Time</th>
                  <th className="px-4 py-3 text-left">Actor</th>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Entity</th>
                  <th className="px-4 py-3 text-left">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-apple-divider align-top last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-3 text-apple-text-tertiary">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {e.actorId ? (
                        <Link href={qs(base, { actorId: e.actorId, page: undefined })} className="hover:text-apple-blue">
                          {e.actor?.name ?? e.actor?.phone ?? "unknown"}
                        </Link>
                      ) : (
                        <span className="text-apple-text-tertiary">system</span>
                      )}
                      {e.actorRole && <span className="ml-1 text-apple-xs text-apple-text-tertiary">{e.actorRole}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={qs(base, { action: e.action, page: undefined })}>
                        <StatusBadge status={e.action} size="sm" />
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-apple-text-secondary">
                      <Link href={qs(base, { entityType: e.entityType, page: undefined })} className="hover:text-apple-blue">{e.entityType}</Link>{" "}
                      <span className="font-mono text-apple-xs text-apple-text-tertiary" title={e.entityId}>{e.entityId.slice(0, 8)}</span>
                    </td>
                    <td className="max-w-md px-4 py-3 text-apple-xs text-apple-text-secondary">
                      <AuditDetail before={e.before} after={e.after} metadata={e.metadata} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-apple-divider px-4 py-3 text-apple-sm">
            <span className="text-apple-text-tertiary">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Link href={qs(base, { page: String(page - 1) })} className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-apple-sm">
                  <ChevronLeft className="h-4 w-4" /> Newer
                </Link>
              ) : (
                <span />
              )}
              {page < totalPages && (
                <Link href={qs(base, { page: String(page + 1) })} className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-apple-sm">
                  Older <ChevronRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>
      {!full && (
        <p className="text-apple-xs text-apple-text-tertiary">
          Scoped admins see actions by staff at their assigned locations and entries tagged with those locations.
        </p>
      )}
    </div>
  );
}
