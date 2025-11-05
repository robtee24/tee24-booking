import Link from "next/link";
import { supabase } from "../lib/supabase";

export default async function Home() {
  const { data: locations, error } = await supabase
    .from("locations")
    .select("name, slug")
    .order("name", { ascending: true });

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Tee24 Booking</h1>
        <p className="text-red-600">Error: {error.message}</p>
      </main>
    );
  }

  return (
    <main className="p-6 max-w-xl">
      <h1 className="text-2xl font-semibold mb-4">Choose a location</h1>
      <ul className="space-y-3">
        {(locations ?? []).map((loc) => (
          <li key={loc.slug}>
            <Link
              href={`/book/${loc.slug}`}
              className="block rounded-lg border p-4 hover:bg-gray-50"
            >
              <div className="font-medium">{loc.name}</div>
              <div className="text-sm text-gray-600">/book/{loc.slug}</div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
