/**
 * Global search — searches across members, payments, invoices, documents,
 * bookings, automations, tasks. Returns lightweight result rows.
 *
 * v1: ILIKE substring match across the most useful columns.
 * v2 (future): Postgres full-text search w/ tsvectors and trigram for fuzzy.
 */
import { getPrisma } from "@/lib/db";

export type SearchResult = {
  type: "member" | "invoice" | "document" | "booking" | "automation" | "task";
  id: string;
  title: string;
  subtitle?: string;
  link: string;
  context?: string;
};

export type SearchOptions = {
  organizationId?: string | null;
  locationIds?: string[];
  limit?: number;
};

export async function globalSearch(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const limit = opts.limit ?? 8;
  const prisma = getPrisma();
  const locationFilter = opts.locationIds?.length ? { in: opts.locationIds } : undefined;

  const results: SearchResult[] = [];

  // Members: name, email, phone
  const memberRows = await prisma.member.findMany({
    where: {
      ...(locationFilter ? { locationId: locationFilter } : {}),
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { fullName: { contains: q, mode: "insensitive" } },
      ],
    },
    take: limit,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      status: true,
      location: { select: { slug: true, name: true } },
    },
  });

  for (const m of memberRows) {
    results.push({
      type: "member",
      id: m.id,
      title: `${m.firstName} ${m.lastName}`,
      subtitle: `${m.email} · ${m.phone}`,
      link: `/admin/locations/${m.location.slug}/members/list/${m.id}`,
      context: `${m.location.name} · ${m.status}`,
    });
  }

  // Invoices: by number or member name
  const invoiceNum = Number(q);
  if (!Number.isNaN(invoiceNum)) {
    const invoiceRows = await prisma.invoice.findMany({
      where: {
        number: invoiceNum,
        ...(locationFilter ? { locationId: locationFilter } : {}),
      },
      take: limit,
      select: {
        id: true,
        number: true,
        status: true,
        totalCents: true,
        location: { select: { slug: true } },
        member: { select: { firstName: true, lastName: true } },
      },
    });
    for (const i of invoiceRows) {
      results.push({
        type: "invoice",
        id: i.id,
        title: `Invoice #${i.number} — $${(i.totalCents / 100).toFixed(2)}`,
        subtitle: `${i.member.firstName} ${i.member.lastName}`,
        link: `/admin/locations/${i.location.slug}/billing/payments/${i.id}`,
        context: i.status,
      });
    }
  }

  // Bookings: email or phone match
  const bookingRows = await prisma.booking.findMany({
    where: {
      ...(locationFilter ? { locationId: locationFilter } : {}),
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    },
    take: limit,
    orderBy: { start: "desc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      bayNumber: true,
      start: true,
      Location: { select: { slug: true, name: true } },
    },
  });

  for (const b of bookingRows) {
    results.push({
      type: "booking",
      id: b.id,
      title: `${b.firstName} ${b.lastName} — Bay ${b.bayNumber}`,
      subtitle: new Date(b.start).toLocaleString(),
      link: `/admin/locations/${b.Location.slug}/scheduling/bookings?bookingId=${b.id}`,
      context: b.Location.name,
    });
  }

  // Tasks
  const taskRows = await prisma.task.findMany({
    where: {
      ...(locationFilter ? { locationId: locationFilter } : {}),
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { body: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 4,
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true, locationId: true },
  });

  for (const t of taskRows) {
    results.push({
      type: "task",
      id: t.id,
      title: t.title,
      link: `/admin/tasks/${t.id}`,
      context: t.status,
    });
  }

  return results.slice(0, limit);
}
