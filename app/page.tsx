// app/page.tsx
import Link from "next/link";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic"; // always SSR

export const metadata = {
  title: "Tee24 Reservations",
  description: "Where Would You Like To Play?",
};

export default async function Home() {
  let locations:
    | { id: string; name: string; slug: string }[]
    | null = null;

  try {
    locations = await getPrisma().location.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });
  } catch {
    locations = null;
  }

  if (!locations || locations.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-apple-3xl font-semibold tracking-tight text-apple-text mb-3">
          Where Would You Like To Play?
        </h1>
        {!locations ? (
          <p className="text-apple-base text-apple-text-secondary leading-relaxed">
            We couldn&apos;t reach the database just now. If this is a fresh deploy,
            verify your <code className="rounded-apple-sm bg-apple-fill-secondary px-1.5 py-0.5 text-apple-sm font-mono">DATABASE_URL</code> env var on Vercel and that your
            database is accessible from the cloud. This page will start listing
            locations automatically once the connection works.
          </p>
        ) : (
          <p className="text-apple-base text-apple-text-secondary leading-relaxed">
            No locations were found. Add a location in the admin console and
            redeploy, then this page will list them automatically.
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-apple-3xl font-semibold tracking-tight text-apple-text mb-2">
        Where Would You Like To Play?
      </h1>
      <p className="text-apple-base text-apple-text-secondary mb-10">
        Choose a location to book your bay or view the schedule.
      </p>

      <ul className="space-y-3">
        {locations.map((loc) => (
          <li
            key={loc.id}
            className="card flex flex-col sm:flex-row sm:items-center justify-between p-5 transition-shadow duration-200 hover:shadow-apple-md"
          >
            <div className="mb-3 sm:mb-0">
              <div className="text-apple-lg font-semibold text-apple-text">{loc.name}</div>
              <div className="text-apple-sm text-apple-text-tertiary">/{loc.slug}</div>
            </div>

            <div className="flex gap-2">
              <Link
                href={`/book/${loc.slug}`}
                className="btn-primary"
              >
                Book {loc.name}
              </Link>
              <Link
                href={`/schedule?slug=${encodeURIComponent(loc.slug)}`}
                className="btn-secondary"
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
