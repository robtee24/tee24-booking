import Link from "next/link";
import { Plus, ShieldCheck } from "lucide-react";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { adminRoutes } from "@/lib/admin/routes";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { listStaffAdmins } from "@/services/staff.service";

export const dynamic = "force-dynamic";

export default async function LocationAdminsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const location = await getPrisma().location.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!location) return null;
  const me = await getCurrentAdmin();
  if (!me) return null;
  const full = isFullAccess(me.role);
  const [scoped, all] = await Promise.all([
    listStaffAdmins({ locationIds: [location.id] }),
    listStaffAdmins(),
  ]);
  const orgWide = all.filter((a) => a.role === "ROOT" || a.role === "FULL");
  const seen = new Set(scoped.map((a) => a.id));
  const extras = orgWide.filter((a) => !seen.has(a.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Location admins"
        description={`Staff who can manage ${location.name}. Scoped admins only see locations assigned to them; ROOT and FULL see every location.`}
        actions={
          full ? (
            <Link href={adminRoutes.adminNew()}>
              <Button iconLeft={<Plus className="h-4 w-4" />}>Add admin</Button>
            </Link>
          ) : undefined
        }
      />

      {scoped.length === 0 && extras.length === 0 ? (
        <EmptyState title="No staff assigned" description="Add a scoped admin and assign them this location, or a FULL admin who can work everywhere." />
      ) : (
        <Card padded={false}>
          <CardHeader title="Assigned to this location" subtitle="Scoped staff plus anyone with organization-wide access." />
          <ul className="divide-y divide-apple-divider">
            {[...scoped, ...extras].map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div>
                  <Link href={adminRoutes.adminDetail(a.id)} className="font-medium text-apple-text hover:text-apple-blue">
                    {a.name ?? "Unnamed"}
                  </Link>
                  <div className="text-apple-xs text-apple-text-tertiary">{a.email ?? a.phone}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge size="sm" tone={a.role === "ROOT" ? "danger" : a.role === "FULL" ? "info" : "default"}>{a.role}</Badge>
                  {a.twoFactorEnabled && <ShieldCheck className="h-3.5 w-3.5 text-apple-green" aria-label="2FA enabled" />}
                  <Badge size="sm" tone={a.inviteStatus === "ACTIVE" ? "success" : "warn"}>{a.inviteStatus === "ACTIVE" ? "Active" : "Invited"}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-apple-sm text-apple-text-secondary">
        Roles and permissions are managed on the{" "}
        <Link href={adminRoutes.admins()} className="font-medium text-apple-blue hover:underline">
          organization admins
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
