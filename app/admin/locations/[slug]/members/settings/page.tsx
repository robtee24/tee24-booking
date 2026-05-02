import { Card, CardHeader, PageHeader } from "@/components/ui";
import Link from "next/link";

export default async function MemberSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const links = [
    { label: "Tags", href: `/admin/locations/${slug}/members/tags`, desc: "Create and manage member tags." },
    { label: "Custom fields", href: `/admin/locations/${slug}/members/custom-fields`, desc: "Add fields to signup & profile." },
    { label: "Documents", href: `/admin/locations/${slug}/members/documents`, desc: "Waivers and required forms." },
    { label: "Signup forms", href: `/admin/locations/${slug}/marketing/signup-forms`, desc: "Public checkout pages." },
    { label: "Communications", href: `/admin/locations/${slug}/settings/comms`, desc: "Booking & system emails/SMS." },
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
