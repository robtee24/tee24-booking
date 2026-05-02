import Link from "next/link";
import { Card, CardHeader } from "@/components/ui";
import { getCurrentMember } from "@/lib/member-session";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PortalSchedule() {
  const member = await getCurrentMember();
  if (!member) return null;
  const prisma = getPrisma();

  const locations = await prisma.location.findMany({
    where: { disabled: false },
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true },
  });

  const home = member.location;

  return (
    <div className="space-y-6">
      <h1 className="text-apple-2xl font-semibold tracking-tight">Book a bay</h1>
      <p className="text-apple-base text-apple-text-secondary">Reserve a bay at any of our locations.</p>

      <Card>
        <CardHeader title="Pick a location" subtitle={home ? `Your home: ${home.name}` : undefined} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((loc) => (
            <Link
              key={loc.id}
              href={`/book/${loc.slug}?member=${member.id}`}
              className={[
                "rounded-apple border p-4 transition-colors hover:border-apple-blue",
                home?.id === loc.id ? "border-apple-blue bg-apple-blue/5" : "border-apple-border bg-white",
              ].join(" ")}
            >
              <div className="font-medium text-apple-text">{loc.name}</div>
              <div className="mt-1 text-apple-xs text-apple-text-tertiary">Open scheduler →</div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
