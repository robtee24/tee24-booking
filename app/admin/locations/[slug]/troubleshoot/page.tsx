import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { getAdminBayRows } from "@/services/bay.service";
import { getRemoteConfig } from "@/lib/remote/meshcentral";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { adminRoutes } from "@/lib/admin/routes";
import { TROUBLESHOOTING_TREE, entryNodeFor } from "@/lib/kiosk/troubleshooting";
import { TroubleshootBays } from "./TroubleshootBays";
import { TroubleshootGuidePicker } from "./TroubleshootGuidePicker";

export const dynamic = "force-dynamic";

export default async function TroubleshootPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await params;
  const slug = decodeURIComponent(raw);
  const location = await getPrisma().location.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!location) notFound();

  const bays = await getAdminBayRows(location.id).catch(() => []);
  const remote = getRemoteConfig();
  const remoteState = {
    configured: !!remote,
    serverUrl: remote?.url ?? null,
    agentDownloadReady: !!remote?.meshId,
    singleSignOn: !!remote?.loginTokenKey,
  };

  const guideEntries = Array.from(new Set(bays.map((b) => entryNodeFor(b.launchMonitor)))).map((id) => ({
    id,
    label: TROUBLESHOOTING_TREE[id]?.category ?? id,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Troubleshoot"
        description={`Remote into any bay computer at ${location.name}, see which kiosks are online, and walk the same guide players see on the bay.`}
      />

      <TroubleshootBays slug={slug} bays={bays} remote={remoteState} />

      {!remoteState.configured && (
        <Card>
          <CardHeader title="Set up remote access (one time)" subtitle="Tee24 uses MeshCentral — open source, self-hosted, browser-based remote desktop. Agents dial out from each bay PC, so nothing to open on the sim network." />
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-apple-sm text-apple-text">
            <li>
              Host MeshCentral on a small VPS with a public hostname (e.g. <code className="rounded bg-apple-fill-secondary px-1">mesh.tee24.golf</code>):{" "}
              <code className="rounded bg-apple-fill-secondary px-1">npm i meshcentral && node node_modules/meshcentral --cert mesh.tee24.golf</code> (or the official Docker image).
            </li>
            <li>
              In <code className="rounded bg-apple-fill-secondary px-1">meshcentral-data/config.json</code> set{" "}
              <code className="rounded bg-apple-fill-secondary px-1">{`"settings": { "allowLoginToken": true, "allowFraming": true }`}</code>, create an account named <code className="rounded bg-apple-fill-secondary px-1">tee24</code>, and create a device group called <strong>Tee24 Bays</strong>.
            </li>
            <li>
              Run <code className="rounded bg-apple-fill-secondary px-1">node node_modules/meshcentral --logintokenkey</code> and copy the key.
            </li>
            <li>
              In Vercel, add <code className="rounded bg-apple-fill-secondary px-1">MESHCENTRAL_URL</code>, <code className="rounded bg-apple-fill-secondary px-1">MESHCENTRAL_MESH_ID</code> (the device group&apos;s Mesh ID), and <code className="rounded bg-apple-fill-secondary px-1">MESHCENTRAL_LOGIN_TOKEN_KEY</code>, then redeploy.
            </li>
            <li>On each bay, open the kiosk&apos;s Settings → Remote support → Install agent. The bay appears here as soon as it reports in.</li>
          </ol>
        </Card>
      )}

      <Card>
        <CardHeader title="Troubleshooting guide" subtitle="The same decision tree the kiosk Help button opens. Pick a launch monitor to start where that bay would." />
        <div className="mt-4">
          <TroubleshootGuidePicker tree={TROUBLESHOOTING_TREE} entries={guideEntries} />
        </div>
      </Card>

      <p className="text-apple-xs text-apple-text-tertiary">
        Kiosk timing (unlock window, upcoming reminder) lives in{" "}
        <Link href={adminRoutes.loc.settings.bayApp(slug)} className="font-medium text-apple-blue hover:underline">Location Settings → Bay Kiosk</Link>.
        Install the kiosk from <Link href="/desktop-app" className="font-medium text-apple-blue hover:underline">reservations.tee24.golf/desktop-app</Link>.
      </p>
    </div>
  );
}
