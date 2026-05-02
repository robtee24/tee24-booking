import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, Button, StatusBadge } from "@/components/ui";
import { BarChart, KpiCard } from "@/components/ui/charts";
import { Plus, ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SignupFormsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const thirtyAgo = new Date();
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);

  // Forms list and per-form attribution come from members tagged with the form slug
  // in the `source` field, so we can show signup-form conversion without an extra
  // submissions table.
  const [forms, recentSignups] = await Promise.all([
    prisma.signupForm.findMany({
      where: { OR: [{ organizationId: location.organizationId }, { locationId: location.id }] },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.member.findMany({
      where: { locationId: location.id, joinDate: { gte: thirtyAgo } },
      select: { source: true },
    }),
  ]);

  const sourceCounts = new Map<string, number>();
  for (const r of recentSignups) {
    if (!r.source) continue;
    sourceCounts.set(r.source, (sourceCounts.get(r.source) ?? 0) + 1);
  }
  const totalSignups30d = recentSignups.length;
  const activeForms = forms.filter((f) => f.active).length;
  const formPerformance = forms
    .map((f) => ({
      name: f.name,
      submissions: sourceCounts.get(`form:${f.slug}`) ?? sourceCounts.get(f.slug) ?? 0,
    }))
    .sort((a, b) => b.submissions - a.submissions)
    .slice(0, 8);
  const hasPerformance = formPerformance.some((f) => f.submissions > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Signup forms"
        description="Each form has its own URL — perfect for membership pages, day-pass landings, or referral links."
        actions={<Button iconLeft={<Plus className="h-4 w-4" />}>New signup form</Button>}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard label="Active forms" value={activeForms.toLocaleString()} hint={`of ${forms.length}`} />
        <KpiCard label="Signups (30d)" value={totalSignups30d.toLocaleString()} />
        <KpiCard
          label="Top form (30d)"
          value={hasPerformance ? formPerformance[0].name : "—"}
          hint={hasPerformance ? `${formPerformance[0].submissions} signups` : undefined}
        />
      </div>

      {hasPerformance && (
        <Card>
          <CardHeader title="Form performance" subtitle="Signups attributed in the last 30 days" />
          <div className="mt-4">
            <BarChart
              data={formPerformance}
              xKey="name"
              series={[{ key: "submissions", label: "Signups" }]}
              layout="vertical"
              height={Math.max(220, formPerformance.length * 28)}
            />
          </div>
        </Card>
      )}

      {forms.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No signup forms yet" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {forms.map((f) => (
            <Card key={f.id}>
              <CardHeader
                title={f.name}
                subtitle={f.description ?? undefined}
                action={<StatusBadge status={f.active ? "ACTIVE" : "CANCELLED"} size="sm" />}
              />
              <div className="mt-3 flex items-center justify-between text-apple-xs">
                <code className="rounded bg-apple-fill-secondary px-2 py-1 text-apple-text-secondary">
                  /signup/{f.slug}
                </code>
                <Link
                  href={`/signup/${f.slug}`}
                  className="font-medium text-apple-blue hover:underline"
                >
                  Preview →
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
