import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, Button, StatusBadge } from "@/components/ui";
import { Plus, ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SignupFormsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const forms = await prisma.signupForm.findMany({
    where: { OR: [{ organizationId: location.organizationId }, { locationId: location.id }] },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Signup forms"
        description="Each form has its own URL — perfect for membership pages, day-pass landings, or referral links."
        actions={<Button iconLeft={<Plus className="h-4 w-4" />}>New signup form</Button>}
      />
      {forms.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No signup forms yet" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {forms.map((f) => (
            <Card key={f.id}>
              <CardHeader title={f.name} subtitle={f.description ?? undefined} action={<StatusBadge status={f.active ? "ACTIVE" : "CANCELLED"} size="sm" />} />
              <div className="mt-3 flex items-center justify-between text-apple-xs">
                <code className="rounded bg-apple-fill-secondary px-2 py-1 text-apple-text-secondary">/signup/{f.slug}</code>
                <Link href={`/signup/${f.slug}`} className="font-medium text-apple-blue hover:underline">Preview →</Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
