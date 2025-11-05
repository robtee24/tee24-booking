// app/display/[locationSlug]/page.tsx
/**
 * Updated for Next.js 15+ (params is now a Promise)
 */

export default async function DisplayBoard({
  params,
}: {
  params: Promise<{ locationSlug: string }>;
}) {
  const resolved = await params;
  const slug = resolved?.locationSlug ?? "(missing)";

  return (
    <main>
      <h1 className="text-2xl font-bold">Display Board: {slug}</h1>
      <p className="text-gray-600">
        Airport-style next 5 per bay (auto-refresh)
      </p>
    </main>
  );
}
