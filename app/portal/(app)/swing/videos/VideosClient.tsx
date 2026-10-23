"use client";

import React from "react";
import Link from "next/link";
import { Video } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { api, errMsg, SwingHeader, type AnalysisSummary } from "../shared";
import { VideoTile } from "../SwingHome";

export function VideosClient() {
  const [data, setData] = React.useState<{ enabled: boolean; analyses: AnalysisSummary[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(() => api<{ enabled: boolean; analyses: AnalysisSummary[] }>("/api/portal/practice/swing?limit=60").then((r) => setData({ enabled: r.enabled, analyses: r.analyses })).catch((e) => setError(errMsg(e))), []);
  React.useEffect(() => { void load(); }, [load]);
  const inFlight = data?.analyses.some((a) => a.status === "UPLOADED" || a.status === "PENDING") ?? false;
  React.useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
  }, [inFlight, load]);

  return (
    <div className="space-y-6">
      <SwingHeader subtitle="Every swing video you've analyzed. Upload new ones from the overview." />
      {error && <div className="rounded-apple-sm bg-apple-red/10 px-4 py-3 text-apple-sm text-apple-red">{error}</div>}
      {!data && !error && <p className="text-apple-sm text-apple-text-tertiary">Loading…</p>}
      {data && data.analyses.length === 0 && (
        <Card>
          <EmptyState icon={<Video className="h-8 w-8" />} title="No swing videos yet" description="Film one swing with your whole body in frame and upload it from the Swing Lab overview." action={<Link href="/portal/swing" className="text-apple-sm font-medium text-apple-blue hover:underline">Go to overview →</Link>} />
        </Card>
      )}
      {data && data.analyses.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.analyses.map((a) => <VideoTile key={a.id} a={a} />)}
        </div>
      )}
    </div>
  );
}
