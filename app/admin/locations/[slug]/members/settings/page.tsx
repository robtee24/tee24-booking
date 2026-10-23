import { Card, CardHeader, PageHeader } from "@/components/ui";
import Link from "next/link";
import { adminRoutes } from "@/lib/admin/routes";

export default async function MemberSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const links = [
    { label: "Tags", href: adminRoutes.loc.members.tags(slug), desc: "Create and manage member tags." },
    { label: "Custom fields", href: adminRoutes.loc.members.customFields(slug), desc: "Add fields to signup & profile." },
    { label: "Documents", href: adminRoutes.loc.members.documents(slug), desc: "Waivers and required forms." },
    { label: "Import members", href: adminRoutes.loc.members.import(slug), desc: "Upload a CSV from GymDesk or another system." },
    { label: "Merge duplicates", href: adminRoutes.loc.members.merge(slug), desc: "Find and combine duplicate member records." },
    { label: "Signup forms", href: adminRoutes.loc.marketing.signupForms(slug), desc: "Public checkout pages." },
    { label: "Communications", href: adminRoutes.loc.settings.comms(slug), desc: "Booking & system emails/SMS." },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Member settings" description="Configure member-related modules in one place." />
      <div className="grid gap-3 sm:grid-cols-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            <Card className="transition-shadow hover:shadow-apple-md">
              <CardHeader title={l.label} subtitle={l.desc} />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
