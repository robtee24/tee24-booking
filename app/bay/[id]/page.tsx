// app/bay/[id]/page.tsx
/**
 * Debug page to inspect exactly what Next.js passes into a dynamic segment page.
 * Compatible with Next.js 15+ (both params and searchParams are Promises).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id?: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await params;
  const resolvedSearch = (await searchParams) ?? {};
  const id = resolvedParams?.id ?? "(missing)";

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
            {JSON.stringify(resolvedParams, null, 2)}
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
                searchParams: resolvedSearch,
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

