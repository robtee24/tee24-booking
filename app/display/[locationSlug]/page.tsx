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
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-apple-2xl font-semibold tracking-tight text-apple-text">Display Board: {slug}</h1>
      <p className="text-apple-base text-apple-text-secondary">
        Airport-style next 5 per bay (auto-refresh)
      </p>
    </main>
  );
}
