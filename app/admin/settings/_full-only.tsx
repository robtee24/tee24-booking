// Server-side gate for org-wide settings pages. Middleware only proves there is
// *a* session; pages that expose org-level data (webhook health, ML models,
// migration stats) must also be limited to ROOT/FULL like the API they mirror.
import Link from "next/link";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { adminRoutes } from "@/lib/admin/routes";
import { Card, PageHeader } from "@/components/ui";

export async function requireFullAccessPage(title: string): Promise<React.ReactElement | null> {
  const me = await getCurrentAdmin();
  if (me && isFullAccess(me.role)) return null;
  return (
    <div className="space-y-6">
      <PageHeader title={title} />
      <Card>
        <p className="text-apple-sm text-apple-text-secondary">Only ROOT or FULL admins can view this page.</p>
        <Link href={adminRoutes.settings()} className="mt-3 inline-block text-apple-sm font-medium text-apple-blue hover:underline">← Back to settings</Link>
      </Card>
    </div>
  );
}
