import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { PageHeader } from "@/components/ui";
import { ImportMembers } from "@/components/admin/members/ImportMembers";

export const dynamic = "force-dynamic";

export default async function ImportMembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className="space-y-6">
      <Link href={adminRoutes.loc.members.settings(slug)} className="inline-flex items-center gap-1 text-apple-sm text-apple-text-secondary hover:text-apple-text">
        <ArrowLeft className="h-4 w-4" />
        Member settings
      </Link>
      <PageHeader title="Import members" description="Upload a CSV export from your previous system. Existing members (matched by email) are updated, new ones are created." />
      <ImportMembers slug={slug} />
    </div>
  );
}
