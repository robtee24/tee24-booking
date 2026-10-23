"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, useToast } from "@/components/ui";
import { api, errMsg, FlagList, fmtDate, n0, n1, severityTone, Stat, StatusPill, SwingHeader, type AnalysisSummary, type Flag } from "../../shared";

type Analysis = Omit<AnalysisSummary, "thumbnail" | "topFeedback" | "feedbackCount"> & {
  flags: Flag[];
  assets: { annotatedVideo: string | null; clubPathVideo: string | null; clubCompareVideo: string | null; sideBySideVideo: string | null; phaseGrid: string | null; wristPlot: string | null; stills: Record<string, string> } | null;
  report: {
    source: { fps: number; duration_s: number };
    view: string;
    handedness: string;
    phases: { events: { event: string; label: string; time_s: number }[] };
    metrics: { summary: { name: string; value: number | null; unit: string; reliable: boolean; note: string }[] };
    feedback: { rule: string; kind: string; phase: string; metric: string; severity: number; title: string; message: string; drill?: string | null; value?: number | null; threshold?: number | null }[];
    warnings: string[];
    highlights: string[];
  } | null;
};

const PHASE_LABEL: Record<string, string> = { ADDRESS: "Address", TOE_UP: "Toe up", MID_BACKSWING: "Mid backswing", TOP: "Top", MID_DOWNSWING: "Mid downswing", IMPACT: "Impact", MID_FOLLOW_THROUGH: "Follow through", FINISH: "Finish" };
const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function VideoDetail({ id, readOnly }: { id: string; readOnly: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [a, setA] = React.useState<Analysis | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [video, setVideo] = React.useState<"annotated" | "clubPath" | "compare" | "sideBySide">("annotated");

  const load = React.useCallback(() => api<{ analysis: Analysis }>(`/api/portal/practice/swing/${id}`).then((r) => setA(r.analysis)).catch((e) => setError(errMsg(e))), [id]);
  React.useEffect(() => { void load(); }, [load]);
  const inFlight = a?.status === "UPLOADED" || a?.status === "PENDING";
  React.useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [inFlight, load]);

  async function remove() {
    if (!confirm("Delete this swing analysis?")) return;
    try {
      await api(`/api/portal/practice/swing/${id}`, { method: "DELETE" });
      toast({ tone: "success", title: "Deleted" });
      router.push("/portal/swing/videos");
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't delete", description: errMsg(e) });
    }
  }

  const src = a?.assets ? ({ annotated: a.assets.annotatedVideo, clubPath: a.assets.clubPathVideo, compare: a.assets.clubCompareVideo, sideBySide: a.assets.sideBySideVideo } as const)[video] : null;
  const videoOptions = a?.assets
    ? ([
        ["annotated", "Annotated", a.assets.annotatedVideo],
        ["clubPath", "Club path", a.assets.clubPathVideo],
        ["compare", "vs. pro", a.assets.clubCompareVideo],
        ["sideBySide", "Side by side", a.assets.sideBySideVideo],
      ] as const).filter(([, , url]) => url)
    : [];
  const reliable = a?.report?.metrics.summary.filter((m) => m.reliable && m.value != null) ?? [];

  return (
    <div className="space-y-6">
      <SwingHeader />
      <Link href="/portal/swing/videos" className="inline-flex items-center gap-1 text-apple-sm text-apple-text-secondary hover:text-apple-text"><ArrowLeft className="h-4 w-4" /> All swing videos</Link>
      {error && <div className="rounded-apple-sm bg-apple-red/10 px-4 py-3 text-apple-sm text-apple-red">{error}</div>}
      {!a && !error && <p className="text-apple-sm text-apple-text-tertiary">Loading…</p>}

      {a && (
        <>
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-apple-xl font-semibold text-apple-text">{a.title ?? `Swing${a.club ? ` · ${a.club}` : ""}`}</h2>
                  <StatusPill status={a.status} />
                </div>
                <div className="text-apple-sm text-apple-text-secondary">
                  {fmtDate(a.recordedAt, { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · {a.handedness === "LH" ? "Left-handed" : "Right-handed"} · {pretty(a.detectedView ?? a.view)}{a.club ? ` · ${a.club}` : ""}
                </div>
                {a.notes && <p className="mt-2 text-apple-sm text-apple-text-secondary">{a.notes}</p>}
              </div>
              {!readOnly && <Button variant="danger" size="sm" iconLeft={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void remove()}>Delete</Button>}
            </div>
            {a.status === "DONE" && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Swing score" value={a.score != null ? n0(a.score) : "—"} hint="out of 100" />
                <Stat label="Coaching notes" value={a.report?.feedback.length ?? 0} />
                <Stat label="Highlights" value={a.report?.highlights.length ?? 0} />
                <Stat label="Clip" value={a.report ? `${n1(a.report.source.duration_s)}s` : "—"} hint={a.report ? `${Math.round(a.report.source.fps)} fps` : undefined} />
              </div>
            )}
            {inFlight && <p className="mt-4 text-apple-sm text-apple-text-secondary">We&apos;re analyzing your swing — this usually takes a minute or two. This page refreshes on its own.</p>}
            {a.status === "ERROR" && <p className="mt-4 text-apple-sm text-apple-red">{a.error ?? "The analysis failed."}</p>}
            {a.status === "EXPIRED" && <p className="mt-4 text-apple-sm text-apple-text-secondary">The upload never finished. Delete this and try again.</p>}
          </Card>

          {a.status === "DONE" && a.assets && (
            <>
              <Card>
                <CardHeader
                  title="Video"
                  action={
                    videoOptions.length > 1 ? (
                      <div className="flex flex-wrap gap-1">
                        {videoOptions.map(([k, label]) => (
                          <button key={k} type="button" onClick={() => setVideo(k)} className={`rounded-apple-pill px-2.5 py-1 text-apple-xs font-medium ${video === k ? "bg-apple-text text-white" : "bg-apple-fill-secondary text-apple-text-secondary hover:text-apple-text"}`}>{label}</button>
                        ))}
                      </div>
                    ) : undefined
                  }
                />
                <div className="mt-3 overflow-hidden rounded-apple-sm bg-black">
                  {src ? <video key={src} src={src} controls playsInline className="mx-auto max-h-[70vh] w-full" /> : <div className="p-8 text-center text-apple-sm text-apple-text-tertiary">No rendered video available.</div>}
                </div>
              </Card>

              {Object.keys(a.assets.stills).length > 0 && (
                <Card>
                  <CardHeader title="Positions" subtitle="Key frames from your swing" />
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {Object.entries(a.assets.stills).map(([k, url]) => (
                      <figure key={k} className="overflow-hidden rounded-apple-sm border border-apple-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={PHASE_LABEL[k] ?? k} className="aspect-[3/4] w-full object-cover" />
                        <figcaption className="px-2 py-1 text-center text-apple-xs text-apple-text-secondary">{PHASE_LABEL[k] ?? pretty(k)}</figcaption>
                      </figure>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}

          {a.status === "DONE" && a.report && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Coaching notes" subtitle="Biggest opportunities first" />
                {a.report.feedback.length ? (
                  <ul className="mt-3 space-y-3">
                    {[...a.report.feedback].sort((x, y) => y.severity - x.severity).map((f) => (
                      <li key={f.rule} className="rounded-apple-sm border border-apple-border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={severityTone(f.severity)} size="sm">{pretty(f.phase)}</Badge>
                          <span className="text-apple-sm font-medium text-apple-text">{f.title}</span>
                        </div>
                        <p className="mt-1 text-apple-sm text-apple-text-secondary">{f.message}</p>
                        {f.drill && <p className="mt-1 text-apple-xs text-apple-text-tertiary"><span className="font-medium">Try:</span> {f.drill}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-apple-sm text-apple-text-tertiary">Nothing stood out — solid swing.</p>
                )}
              </Card>
              <div className="space-y-4">
                <Card>
                  <CardHeader title="Highlights" />
                  {a.report.highlights.length ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-apple-sm text-apple-text-secondary">{a.report.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
                  ) : (
                    <p className="mt-3 text-apple-sm text-apple-text-tertiary">—</p>
                  )}
                </Card>
                <Card>
                  <CardHeader title="Added to your plan" subtitle="These feed your practice focus" />
                  <div className="mt-3"><FlagList flags={a.flags} compact /></div>
                </Card>
              </div>
            </div>
          )}

          {a.status === "DONE" && reliable.length > 0 && (
            <Card>
              <CardHeader title="Measurements" subtitle="Only metrics the analyzer was confident in" />
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {reliable.map((m) => <Stat key={m.name} label={pretty(m.name)} value={`${n1(m.value)}${m.unit ? ` ${m.unit}` : ""}`} hint={m.note || undefined} />)}
              </div>
              {a.report?.phases.events.length ? (
                <div className="mt-4 flex flex-wrap gap-2 text-apple-xs text-apple-text-tertiary">
                  {a.report.phases.events.map((e) => <span key={e.event} className="rounded-apple-pill bg-apple-fill-secondary px-2 py-0.5">{e.label}: {n1(e.time_s)}s</span>)}
                </div>
              ) : null}
              {a.report?.warnings.length ? <p className="mt-3 text-apple-xs text-apple-text-tertiary">{a.report.warnings.join(" ")}</p> : null}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
