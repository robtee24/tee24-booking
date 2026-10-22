// app/admin/admins/new/page.tsx
import Link from "next/link";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { getPrisma } from "@/lib/db";
import { adminRoutes } from "@/lib/admin/routes";
import { Card, PageHeader } from "@/components/ui";
import { PERMISSION_PRESETS, permissionGroups } from "@/services/staff.service";
import { AdminForm } from "@/components/admin/staff/AdminForm";

export const dynamic = "force-dynamic";

export default async function NewAdminPage() {
  const me = await getCurrentAdmin();
  if (!me) return null;
  if (!isFullAccess(me.role)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Add admin" />
        <Card>
          <p className="text-apple-sm text-apple-text-secondary">Only ROOT or FULL admins can add staff.</p>
          <Link href={adminRoutes.admins()} className="mt-3 inline-block text-apple-sm font-medium text-apple-blue hover:underline">← Back to admins</Link>
        </Card>
      </div>
    );
  }
  const locations = await getPrisma().location.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } });

  return (
    <div className="space-y-6">
      <PageHeader title="Add admin" description="Create a staff account, choose what they can do, and text them the login link." />
      <AdminForm mode="create" catalog={{ groups: permissionGroups(), presets: PERMISSION_PRESETS }} locations={locations} actorRole={me.role} />
    </div>
  );
}
