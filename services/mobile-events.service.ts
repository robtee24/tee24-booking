/**
 * Events feed + RSVP for the member app. (League lives in services/league.service.ts.)
 */
import { getPrisma } from "@/lib/db";
import { MobileError } from "@/services/mobile-auth.service";

/* ────────────────────────────── Events ────────────────────────────────── */

export async function listEventsForMember(memberId: string, opts: { locationId?: string | null; includePast?: boolean } = {}) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { locationId: true, homeLocationId: true } });
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000); // still show events that started <6h ago
  const events = await prisma.event.findMany({
    where: {
      published: true,
      ...(opts.includePast ? {} : { OR: [{ endsAt: { gte: since } }, { endsAt: null, startsAt: { gte: since } }, { kind: "LEAGUE", startsAt: { gte: new Date(Date.now() - 120 * 86_400_000) } }] }),
      ...(opts.locationId ? { OR: [{ locationId: opts.locationId }, { locationId: null }] } : {}),
    },
    include: {
      location: { select: { id: true, slug: true, name: true, timezone: true } },
      rsvps: { where: { memberId }, select: { status: true } },
      _count: { select: { rsvps: { where: { status: "GOING" } } } },
    },
    orderBy: [{ featured: "desc" }, { startsAt: "asc" }],
    take: 60,
  });
  const homeId = member?.homeLocationId ?? member?.locationId ?? null;
  return events.map((e) => ({
    id: e.id,
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
    featured: e.featured,
    location: e.location,
    isHome: e.location ? e.location.id === homeId : true,
    goingCount: e._count.rsvps,
    myRsvp: e.rsvps[0]?.status ?? null,
  }));
}

export async function setRsvp(memberId: string, eventId: string, status: "GOING" | "INTERESTED" | "DECLINED" | null) {
  const prisma = getPrisma();
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, capacity: true, _count: { select: { rsvps: { where: { status: "GOING" } } } } } });
  if (!event) throw new MobileError("Event not found", 404, "NOT_FOUND");
  if (status === null) {
    await prisma.eventRsvp.deleteMany({ where: { eventId, memberId } });
    return { myRsvp: null };
  }
  if (status === "GOING" && event.capacity != null) {
    const mine = await prisma.eventRsvp.findUnique({ where: { eventId_memberId: { eventId, memberId } } });
    if (mine?.status !== "GOING" && event._count.rsvps >= event.capacity) throw new MobileError("This event is full.", 409, "EVENT_FULL");
  }
  await prisma.eventRsvp.upsert({ where: { eventId_memberId: { eventId, memberId } }, update: { status }, create: { eventId, memberId, status } });
  return { myRsvp: status };
}
