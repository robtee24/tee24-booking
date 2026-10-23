import { getPrisma } from "@/lib/db";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { PageHeader } from "@/components/ui";
import { leagueApi, leagueConfigured } from "@/lib/league-api";
import { EventsClient, type EventDTO } from "./EventsClient";

export const dynamic = "force-dynamic";

export default async function EventsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = await getCurrentAdmin();
  if (!admin) return null;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug }, select: { id: true, name: true, slug: true, timezone: true } });
  if (!location) return null;

  const [rows, leagues] = await Promise.all([
    prisma.event.findMany({
      where: { OR: [{ locationId: location.id }, { locationId: null }] },
      orderBy: { startsAt: "desc" },
      take: 200,
      include: { _count: { select: { rsvps: { where: { status: "GOING" } } } } },
    }),
    leagueConfigured() ? leagueApi.leagues().catch(() => [] as { id: number; name: string }[]) : Promise.resolve([] as { id: number; name: string }[]),
  ]);

  const events: EventDTO[] = rows.map((e) => ({
    id: e.id,
    locationId: e.locationId,
    title: e.title,
    description: e.description,
    kind: e.kind,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt?.toISOString() ?? null,
    scheduleNote: e.scheduleNote,
    imageUrl: e.imageUrl,
    ctaLabel: e.ctaLabel,
    ctaUrl: e.ctaUrl,
    leagueId: e.leagueId,
    capacity: e.capacity,
    published: e.published,
    featured: e.featured,
    going: e._count.rsvps,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Events" description="What members see under Events in the app — league nights, clinics, tournaments and socials." />
      <EventsClient events={events} locationId={location.id} leagues={leagues} canCreateOrgWide={isFullAccess(admin.role)} leagueLinked={leagueConfigured()} />
    </div>
  );
}
