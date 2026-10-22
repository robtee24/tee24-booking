// app/admin/admins/[id]/page.tsx — admin detail / edit
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { getPrisma } from "@/lib/db";
import { adminRoutes } from "@/lib/admin/routes";
import { PERMISSIONS } from "@/lib/permissions";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { getStaffAdmin, PERMISSION_PRESETS, permissionGroups } from "@/services/staff.service";
import { AdminForm, type StaffAdminDTO } from "@/components/admin/staff/AdminForm";
import { AdminActionsPanel, InviteBadge } from "@/components/admin/staff/AdminActionsPanel";

export const dynamic = "force-dynamic";

export default async function AdminDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentAdmin();
  if (!me) return null;

  const admin = await getStaffAdmin(decodeURIComponent(id));
  if (!admin) notFound();

  const full = isFullAccess(me.role);
  if (!full) {
    const mine = new Set(me.locations.map((l) => l.locationId));
    if (admin.id !== me.id && !admin.locations.some((l) => mine.has(l.locationId))) notFound();
  }

  const isSelf = admin.id === me.id;
  const canEdit = full && !isSelf && (me.role === "ROOT" || admin.role === "SCOPED");

  const dto: StaffAdminDTO = {
    id: admin.id,
    phone: admin.phone,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    twoFactorEnabled: admin.twoFactorEnabled,
    inviteStatus: admin.inviteStatus,
    invitedAt: admin.invitedAt?.toISOString() ?? null,
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    createdAt: admin.createdAt.toISOString(),
    hasPin: admin.hasPin,
    locations: admin.locations.map((l) => ({ locationId: l.locationId, location: l.location })),
    permissions: admin.permissions.map((p) => ({ permission: p.permission, locationId: p.locationId })),
  };

  const locations = await getPrisma().location.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } });

  return (
    <div className="space-y-6">
      <PageHeader
        title={admin.name || admin.phone}
        description={admin.name ? admin.phone : undefined}
        meta={
          <>
            <Badge tone={admin.role === "ROOT" ? "danger" : admin.role === "FULL" ? "info" : "default"}>{admin.role}</Badge>
            <InviteBadge status={admin.inviteStatus} />
            {isSelf && <Badge tone="muted">This is you</Badge>}
          </>
        }
        actions={
          <Link href={adminRoutes.admins()} className="text-apple-sm font-medium text-apple-blue hover:underline">
            ← All admins
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {canEdit ? (
            <AdminForm mode="edit" admin={dto} catalog={{ groups: permissionGroups(), presets: PERMISSION_PRESETS }} locations={locations} actorRole={me.role} />
          ) : (
            <ReadOnly admin={dto} isSelf={isSelf} />
          )}
        </div>
        <div>
          {full ? (
            <AdminActionsPanel admin={dto} canDelete={canEdit} />
          ) : (
            <Card>
              <CardHeader title="Status" action={<InviteBadge status={admin.inviteStatus} />} />
              <p className="mt-2 text-apple-xs text-apple-text-tertiary">Only ROOT/FULL admins can change roles, permissions, invites, or PINs.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ReadOnly({ admin, isSelf }: { admin: StaffAdminDTO; isSelf: boolean }) {
  const byLoc = new Map<string | null, string[]>();
  for (const g of admin.permissions) {
    const arr = byLoc.get(g.locationId) ?? [];
    arr.push(g.permission);
    byLoc.set(g.locationId, arr);
  }
  const locName = (id: string | null) => (id ? admin.locations.find((l) => l.locationId === id)?.location.name ?? id : "All assigned locations");
  return (
    <div className="space-y-4">
      {isSelf && (
        <Card>
          <p className="text-apple-sm text-apple-text-secondary">
            Edit your own name, email, 2FA, and PIN from{" "}
            <Link href={adminRoutes.settings()} className="font-medium text-apple-blue hover:underline">Settings → My account</Link>.
            Role and permissions are managed by another ROOT admin.
          </p>
        </Card>
      )}
      <Card>
        <CardHeader title="Profile" />
        <dl className="mt-3 grid grid-cols-1 gap-3 text-apple-sm sm:grid-cols-2">
          <div><dt className="text-apple-xs text-apple-text-tertiary">Name</dt><dd>{admin.name ?? "—"}</dd></div>
          <div><dt className="text-apple-xs text-apple-text-tertiary">Email</dt><dd>{admin.email ?? "—"}</dd></div>
          <div><dt className="text-apple-xs text-apple-text-tertiary">Phone</dt><dd className="font-mono">{admin.phone}</dd></div>
          <div><dt className="text-apple-xs text-apple-text-tertiary">Role</dt><dd>{admin.role}</dd></div>
        </dl>
      </Card>
      {admin.role === "SCOPED" && (
        <>
          <Card>
            <CardHeader title="Assigned locations" />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {admin.locations.length === 0 ? <span className="text-apple-sm text-apple-text-tertiary">None</span> : admin.locations.map((l) => <Badge key={l.locationId}>{l.location.name}</Badge>)}
            </div>
          </Card>
          <Card>
            <CardHeader title="Permissions" />
            {byLoc.size === 0 ? (
              <p className="mt-3 text-apple-sm text-apple-text-tertiary">No permissions granted.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {[...byLoc.entries()].map(([loc, perms]) => (
                  <div key={loc ?? "all"}>
                    <div className="text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">{locName(loc)}</div>
                    <ul className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {perms.sort().map((p) => (
                        <li key={p} className="text-apple-sm text-apple-text">
                          {PERMISSIONS[p as keyof typeof PERMISSIONS] ?? p}
                          <span className="ml-1 font-mono text-[10px] text-apple-text-tertiary">{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
