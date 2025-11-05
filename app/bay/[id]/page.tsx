// app/bay/[id]/page.tsx
/**
 * Debug page to inspect exactly what Next.js passes into a dynamic segment page.
 * Visit: /bay/<anything>
 *
 * Updated for Next.js 15+ (params is now a Promise)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageParams = Promise<{ id?: string }>;
type SearchParams = Record<string, string | string[] | undefined>;

export default async function Page({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams?: SearchParams;
}) {
  const resolved = await params;
  const id = resolved?.id ?? "(missing)";

  return (
    <main style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
        Dynamic segment debug
      </h1>

      <section style={{ display: "grid", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Raw params:</div>
          <pre
            style={{
              marginTop: 8,
              padding: 12,
              border: "1px solid #ddd",
              borderRadius: 8,
              background: "#fafafa",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {JSON.stringify(resolved, null, 2)}
          </pre>
        </div>

        <div>
          <div style={{ fontWeight: 600 }}>Derived values:</div>
          <pre
            style={{
              marginTop: 8,
              padding: 12,
              border: "1px solid #ddd",
              borderRadius: 8,
              background: "#fafafa",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {JSON.stringify(
              {
                id,
                searchParams: searchParams ?? "(none)",
              },
              null,
              2
            )}
          </pre>
        </div>

        <p style={{ color: "#555" }}>
          If <code>params.id</code> is still missing here, something outside this page is
          intercepting or rewriting the route. Next step would be to check{" "}
          <code>next.config.js</code> (rewrites), any custom server, and any remaining
          middleware/proxy files.
        </p>
      </section>
    </main>
  );
}

