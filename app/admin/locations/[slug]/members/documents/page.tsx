import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Button, Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { FileText, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DocumentsLibraryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const documents = await prisma.document.findMany({
    where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { assignments: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Waivers, policies, and required signed forms."
        actions={
          <Link href={`/admin/locations/${slug}/members/documents/new`}>
            <Button iconLeft={<Plus className="h-4 w-4" />}>Upload document</Button>
          </Link>
        }
      />

      {documents.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="No documents yet"
          description="Upload a Word document (.docx) and place signature/initial fields. Members sign during signup or anytime from the portal."
          action={
            <Link href={`/admin/locations/${slug}/members/documents/new`}>
              <Button iconLeft={<Plus className="h-4 w-4" />}>Upload document</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((d) => (
            <Card key={d.id}>
              <CardHeader
                title={d.name}
                subtitle={d.description ?? undefined}
                action={d.active ? <StatusBadge status="ACTIVE" size="sm" /> : <StatusBadge status="CANCELLED" size="sm" />}
              />
              <div className="mt-3 grid grid-cols-2 gap-2 text-apple-xs text-apple-text-secondary">
                <div>
                  <div className="text-apple-text-tertiary">Version</div>
                  <div className="text-apple-text">v{d.version}</div>
                </div>
                <div>
                  <div className="text-apple-text-tertiary">Required at signup</div>
                  <div className="text-apple-text">{d.requiredAtSignup ? "Yes" : "No"}</div>
                </div>
                <div>
                  <div className="text-apple-text-tertiary">Expiry</div>
                  <div className="text-apple-text">{d.expiresAfterDays ? `${d.expiresAfterDays} days` : "Never"}</div>
                </div>
                <div>
                  <div className="text-apple-text-tertiary">Signed</div>
                  <div className="text-apple-text">{d._count.assignments}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
