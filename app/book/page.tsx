// SERVER COMPONENT (default)
import { supabase } from "@/lib/supabase";
import ClientDebug from "./ClientDebug";

export default async function Page({
  params,
}: {
  params: Promise<{ locationSlug?: string }>;
}) {
  const resolved = await params;
  const serverSlug = resolved?.locationSlug ?? "(no slug)";

  const { data: location, error: locErr } = await supabase
    .from("locations")
    .select("id, name, slug")
    .eq("slug", serverSlug)
    .maybeSingle();

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Book page (debug)</h1>

      <div className="rounded-md border p-3">
        <div className="text-sm font-medium">Server params</div>
        <pre className="text-xs text-gray-700 whitespace-pre-wrap">
          {JSON.stringify(
            {
              serverParams: resolved,
              serverSlug,
              locErr: locErr?.message ?? null,
              location,
            },
            null,
            2
          )}
        </pre>
      </div>

      <ClientDebug />
    </main>
  );
}
