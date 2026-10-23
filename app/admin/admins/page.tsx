// app/admin/admins/page.tsx — staff roster
import Link from "next/link";
import { Plus, ShieldCheck } from "lucide-react";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { adminRoutes } from "@/lib/admin/routes";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { listStaffAdmins } from "@/services/staff.service";
import { InviteBadge } from "@/components/admin/staff/AdminActionsPanel";
import { ResendInviteButton } from "./ResendInviteButton";

export const dynamic = "force-dynamic";

export default async function AdminsPage() {
  const me = await getCurrentAdmin();
  if (!me) return null;
  const full = isFullAccess(me.role);
  const admins = full ? await listStaffAdmins() : await listStaffAdmins({ locationIds: me.locations.map((l) => l.locationId) });

  const invited = admins.filter((a) => a.inviteStatus !== "ACTIVE").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admins"
        description="Staff accounts, roles, permissions, and invites."
        meta={
          <>
            <Badge tone="muted">{admins.length} total</Badge>
            {invited > 0 && <Badge tone="warn">{invited} pending invite{invited === 1 ? "" : "s"}</Badge>}
          </>
        }
        actions={
          full ? (
            <Link href={adminRoutes.adminNew()} className="btn-primary inline-flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add admin
            </Link>
          ) : undefined
        }
      />

      {admins.length === 0 ? (
        <EmptyState title="No admins yet" description="Add your first staff member to get started." />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-apple-sm">
              <thead className="border-b border-apple-divider bg-apple-fill-secondary text-left">
                <tr className="text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Phone</th>
                  <th className="hidden px-5 py-3 md:table-cell">Role</th>
                  <th className="hidden px-5 py-3 lg:table-cell">Locations</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="hidden px-5 py-3 lg:table-cell">Last login</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => {
                  const locs = a.role === "SCOPED" ? a.locations.map((l) => l.location.name).join(", ") || "None" : "All locations";
                  return (
                    <tr key={a.id} className="border-t border-apple-divider align-middle transition-colors hover:bg-apple-fill-secondary/50">
                      <td className="px-5 py-3.5">
                        <Link href={adminRoutes.adminDetail(a.id)} className="font-medium text-apple-text hover:text-apple-blue">
                          {a.name ?? <span className="text-apple-text-tertiary">Unnamed</span>}
                        </Link>
                        {a.email && <div className="text-apple-xs text-apple-text-tertiary">{a.email}</div>}
                        <div className="mt-1 flex flex-wrap gap-1 md:hidden">
                          <Badge size="sm">{a.role}</Badge>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-apple-xs">{a.phone}</td>
                      <td className="hidden px-5 py-3.5 md:table-cell">
                        <span className="inline-flex items-center gap-1">
                          <Badge size="sm" tone={a.role === "ROOT" ? "danger" : a.role === "FULL" ? "info" : "default"}>{a.role}</Badge>
                          {a.twoFactorEnabled && <ShieldCheck className="h-3.5 w-3.5 text-apple-green" aria-label="2FA enabled" />}
                        </span>
                      </td>
                      <td className="hidden max-w-[16rem] truncate px-5 py-3.5 text-apple-text-secondary lg:table-cell" title={locs}>{locs}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <InviteBadge status={a.inviteStatus} size="sm" />
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap px-5 py-3.5 text-apple-xs text-apple-text-tertiary lg:table-cell">
                        {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleDateString() : "Never"}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {full && a.inviteStatus !== "ACTIVE" && <ResendInviteButton adminId={a.id} />}
                          <Link
                            href={adminRoutes.adminDetail(a.id)}
                            className="rounded-apple-sm border border-apple-border px-3 py-1.5 text-apple-xs font-medium text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text"
                          >
                            {full ? "Manage →" : "View →"}
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
