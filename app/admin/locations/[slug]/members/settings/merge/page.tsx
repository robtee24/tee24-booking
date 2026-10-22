import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { PageHeader } from "@/components/ui";
import { MergeDuplicates } from "@/components/admin/members/MergeDuplicates";

export const dynamic = "force-dynamic";

export default async function MergeMembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className="space-y-6">
      <Link href={adminRoutes.loc.members.settings(slug)} className="inline-flex items-center gap-1 text-apple-sm text-apple-text-secondary hover:text-apple-text">
        <ArrowLeft className="h-4 w-4" />
        Member settings
      </Link>
      <PageHeader title="Merge duplicates" description="Members sharing an email or phone number. Pick the record to keep; everything else (visits, invoices, documents, notes) moves onto it." />
      <MergeDuplicates slug={slug} />
    </div>
  );
}
