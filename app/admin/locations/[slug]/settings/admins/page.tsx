import Link from "next/link";
import { Card, CardHeader, PageHeader } from "@/components/ui";

export default async function LocationAdminsPage({ params }: { params: Promise<{ slug: string }> }) {
  await params;
  return (
    <div className="space-y-6">
      <PageHeader title="Location admins" description="Add staff who can manage this location." />
      <Card>
        <CardHeader title="Per-location admins" subtitle="Scoped admins only see the locations assigned to them." />
        <p className="mt-3 text-apple-sm">
          <Link href="/admin/admins" className="font-medium text-apple-blue hover:underline">
            Manage all admins →
          </Link>
        </p>
      </Card>
    </div>
  );
}
