// app/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tee24 Reservations",
  description: "Where Would You Like To Play?",
};

export default async function Home() {
  const locations = await prisma.location.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });

  if (!locations.length) {
    // Helpful empty state while you’re setting up
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-3xl font-bold mb-2">Where Would You Like To Play?</h1>
        <p className="text-gray-600">
          No locations were found. Add a location in the admin console and
          redeploy, then this page will list them automatically.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-bold mb-6">Where Would You Like To Play?</h1>

      <ul className="space-y-4">
        {locations.map((loc) => (
          <li
            key={loc.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between rounded-xl border p-4"
          >
            <div className="mb-3 sm:mb-0">
              <div className="text-lg font-semibold">{loc.name}</div>
              <div className="text-sm text-gray-500">/{loc.slug}</div>
            </div>

            <div className="flex gap-2">
              {/* Primary: send guests straight to booking */}
              <Link
                href={`/book/${loc.slug}`}
                className="rounded-lg bg-black text-white px-4 py-2 text-sm font-medium hover:opacity-90"
              >
                Book {loc.name}
              </Link>

              {/* Optional: let staff/guests view daily schedule */}
              <Link
                href={`/schedule?slug=${encodeURIComponent(loc.slug)}`}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                View Schedule
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

