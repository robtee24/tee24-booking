"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, FileUp, RefreshCw, Trash2, Upload, Video } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { KpiCard } from "@/components/ui/charts";
import { api, errMsg, fileToBase64, fmtDate, fmtShort, n0, n1, SOURCE_LABEL, Stat, StatusPill, SwingHeader, type AnalysisSummary, type Flag, type SessionRow } from "./shared";

type ExportRow = { id: string; fileName: string; shotCount: number; playedAt: string | null; createdAt: string; status: string; bayNumber: number; location: { id: string; name: string; slug: string } | null; sessionId: string | null; error: string | null };
type Progress = { currentFlags: Flag[]; totals: { sessions: number; shots: number; drillsLogged: number; minutesLogged: number } };

export function SwingHome({ readOnly }: { readOnly: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [sessions, setSessions] = React.useState<SessionRow[] | null>(null);
  const [analyses, setAnalyses] = React.useState<{ enabled: boolean; analyses: AnalysisSummary[] } | null>(null);
  const [exports, setExports] = React.useState<{ exports: ExportRow[]; pendingCount: number } | null>(null);
  const [progress, setProgress] = React.useState<Progress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [videoOpen, setVideoOpen] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);

  const load = React.useCallback(() => {
    setError(null);
    Promise.all([
      api<{ sessions: SessionRow[] }>("/api/portal/practice/sessions?limit=12").then((r) => setSessions(r.sessions)),
      api<{ enabled: boolean; analyses: AnalysisSummary[] }>("/api/portal/practice/swing?limit=6").then((r) => setAnalyses({ enabled: r.enabled, analyses: r.analyses })),
      api<{ exports: ExportRow[]; pendingCount: number }>("/api/portal/practice/exports").then((r) => setExports({ exports: r.exports, pendingCount: r.pendingCount })),
      api<Progress>("/api/portal/practice/progress").then(setProgress),
    ]).catch((e) => setError(errMsg(e)));
  }, []);
  React.useEffect(load, [load]);

  // Poll while a video is still analyzing.
  const inFlight = analyses?.analyses.some((a) => a.status === "UPLOADED" || a.status === "PENDING") ?? false;
  React.useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => api<{ enabled: boolean; analyses: AnalysisSummary[] }>("/api/portal/practice/swing?limit=6").then((r) => setAnalyses({ enabled: r.enabled, analyses: r.analyses })).catch(() => undefined), 6000);
    return () => clearInterval(t);
  }, [inFlight]);

  async function sync() {
    setSyncing(true);
    try {
      const r = await api<{ imported: { fileName: string }[]; failed: { fileName: string; error: string }[]; skipped: unknown[]; planChanged: boolean }>("/api/portal/practice/exports/sync", { method: "POST" });
      toast({ tone: r.failed.length ? "info" : "success", title: `${r.imported.length} session${r.imported.length === 1 ? "" : "s"} imported`, description: r.failed.length ? `${r.failed.length} failed` : r.planChanged ? "Your practice plan was updated." : undefined });
      load();
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Sync failed", description: errMsg(e) });
    } finally {
      setSyncing(false);
    }
  }

  async function deleteSession(id: string) {
    if (!confirm("Delete this session and its shots?")) return;
    try {
      await api(`/api/portal/practice/sessions/${id}`, { method: "DELETE" });
      setSessions((s) => s?.filter((x) => x.id !== id) ?? null);
      toast({ tone: "success", title: "Session deleted" });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't delete", description: errMsg(e) });
    }
  }

  const pending = exports?.exports.filter((e) => e.status === "PENDING") ?? [];

  return (
    <div className="space-y-6">
      <SwingHeader subtitle="Import your launch-monitor data, analyze swing videos and follow a practice plan built from your numbers." />

      {error && <div className="rounded-apple-sm bg-apple-red/10 px-4 py-3 text-apple-sm text-apple-red">{error}</div>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Sessions" value={progress?.totals.sessions ?? "—"} />
        <KpiCard label="Shots analyzed" value={progress?.totals.shots.toLocaleString() ?? "—"} />
        <KpiCard label="Drills logged" value={progress?.totals.drillsLogged ?? "—"} hint="Last 8 weeks" />
        <KpiCard label="Practice minutes" value={progress?.totals.minutesLogged ?? "—"} hint="Last 8 weeks" />
      </div>

      {pending.length > 0 && (
        <div className="flex flex-col gap-3 rounded-apple border border-apple-blue/30 bg-apple-blue/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Download className="mt-0.5 h-5 w-5 text-apple-blue" />
            <div>
              <div className="text-apple-sm font-semibold text-apple-text">{pending.length} shot-data file{pending.length === 1 ? "" : "s"} waiting from the bay</div>
              <div className="text-apple-xs text-apple-text-secondary">
                {pending.slice(0, 3).map((e) => `Bay ${e.bayNumber}${e.location ? ` · ${e.location.name}` : ""} · ${fmtShort(e.playedAt ?? e.createdAt)} · ${e.shotCount} shots`).join(" — ")}
                {pending.length > 3 ? ` and ${pending.length - 3} more` : ""}
              </div>
            </div>
          </div>
          {!readOnly && <Button size="sm" iconLeft={<RefreshCw className="h-3.5 w-3.5" />} loading={syncing} onClick={() => void sync()}>Import all</Button>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Import shot data" subtitle="Export a CSV from GSPro or your launch monitor." />
          <div className="mt-3">
            <Button variant="secondary" iconLeft={<FileUp className="h-4 w-4" />} onClick={() => setImportOpen(true)} disabled={readOnly}>Upload CSV</Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="Analyze a swing video" subtitle="One swing, under 20 seconds, whole body in frame." />
          <div className="mt-3">
            <Button variant="secondary" iconLeft={<Video className="h-4 w-4" />} onClick={() => setVideoOpen(true)} disabled={readOnly || analyses?.enabled === false}>Upload video</Button>
            {analyses?.enabled === false && <p className="mt-2 text-apple-xs text-apple-text-tertiary">Video analysis isn&apos;t available right now.</p>}
          </div>
        </Card>
        <Card>
          <CardHeader title="What to work on" subtitle="From your recent sessions" />
          <div className="mt-3">
            {progress ? (
              progress.currentFlags.length ? (
                <ul className="space-y-1.5 text-apple-sm">
                  {progress.currentFlags.slice(0, 4).map((f) => (
                    <li key={`${f.key}-${f.club}`} className="flex items-center gap-2">
                      <Badge tone={f.severity >= 0.75 ? "danger" : f.severity >= 0.45 ? "warn" : "info"} size="sm">{f.club ?? f.area.replace(/_/g, " ")}</Badge>
                      <span className="text-apple-text">{f.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-apple-sm text-apple-text-tertiary">Import a session to see what the numbers say.</p>
              )
            ) : (
              <p className="text-apple-sm text-apple-text-tertiary">Loading…</p>
            )}
            <Link href="/portal/swing/plan" className="mt-3 inline-block text-apple-sm font-medium text-apple-blue hover:underline">See your practice plan →</Link>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent sessions" action={<Link href="/portal/swing/progress" className="text-apple-sm font-medium text-apple-blue hover:underline">Trends →</Link>} />
        {sessions === null ? (
          <p className="mt-3 text-apple-sm text-apple-text-tertiary">Loading…</p>
        ) : sessions.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon={<Upload className="h-8 w-8" />} title="No sessions yet" description="Upload a CSV from the bay or import the files waiting for you above." />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-apple-divider">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={s.swingAnalysisId ? `/portal/swing/videos/${s.swingAnalysisId}` : `/portal/swing/sessions/${s.id}`} className="font-medium text-apple-text hover:underline">
                    {s.title ?? SOURCE_LABEL[s.source] ?? "Session"}
                  </Link>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {fmtDate(s.playedAt)} · {SOURCE_LABEL[s.source] ?? s.source}{s.shotCount ? ` · ${s.shotCount} shots` : ""}{s.clubs ? ` · ${s.clubs} clubs` : ""}{s.durationMin ? ` · ${s.durationMin} min` : ""}
                  </div>
                  {s.topFlags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.topFlags.map((f) => <Badge key={f.key} tone={f.severity >= 0.75 ? "danger" : "warn"} size="sm">{f.title}</Badge>)}
                    </div>
                  )}
                </div>
                {!readOnly && (
                  <button type="button" onClick={() => void deleteSession(s.id)} className="self-start text-apple-text-tertiary hover:text-apple-red sm:self-center" title="Delete session">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Swing videos" action={<Link href="/portal/swing/videos" className="text-apple-sm font-medium text-apple-blue hover:underline">All videos →</Link>} />
        {analyses === null ? (
          <p className="mt-3 text-apple-sm text-apple-text-tertiary">Loading…</p>
        ) : analyses.analyses.length === 0 ? (
          <p className="mt-3 text-apple-sm text-apple-text-tertiary">No swing videos yet.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {analyses.analyses.map((a) => <VideoTile key={a.id} a={a} />)}
          </div>
        )}
      </Card>

      <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); }} />
      <UploadVideoModal open={videoOpen} onClose={() => setVideoOpen(false)} onDone={() => { setVideoOpen(false); load(); }} />
    </div>
  );
}

export function VideoTile({ a }: { a: AnalysisSummary }) {
  return (
    <Link href={`/portal/swing/videos/${a.id}`} className="group overflow-hidden rounded-apple-sm border border-apple-border bg-white transition-shadow hover:shadow-apple">
      <div className="aspect-video w-full bg-apple-fill-secondary">
        {a.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-apple-text-tertiary"><Video className="h-8 w-8" /></div>
        )}
      </div>
      <div className="space-y-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-apple-sm font-medium text-apple-text">{a.title ?? `Swing${a.club ? ` · ${a.club}` : ""}`}</span>
          <StatusPill status={a.status} />
        </div>
        <div className="text-apple-xs text-apple-text-tertiary">{fmtDate(a.recordedAt)}{a.score != null ? ` · Score ${n0(a.score)}` : ""}{a.feedbackCount ? ` · ${a.feedbackCount} note${a.feedbackCount === 1 ? "" : "s"}` : ""}</div>
        {a.topFeedback.length > 0 && <div className="truncate text-apple-xs text-apple-text-secondary">{a.topFeedback.map((f) => f.title).join(" · ")}</div>}
      </div>
    </Link>
  );
}

/* ───────────────────────────── Import CSV ─────────────────────────────── */

type ImportResult = { session: { id: string; title: string | null; shotCount: number }; summary: { clubs: { club: string; n: number; carry: { mean: number } | null; smash: number | null }[]; flags: Flag[]; highlights: string[] }; unitNotes?: string[]; planChanged: boolean };

function ImportCsvModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);

  React.useEffect(() => { if (open) { setFile(null); setTitle(""); setNotes(""); setError(null); setResult(null); } }, [open]);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      if (file.size > 6 * 1024 * 1024) throw new Error("File is too large (6 MB max)");
      const base64 = await fileToBase64(file);
      const r = await api<ImportResult>("/api/portal/practice/sessions/import", { method: "POST", json: { base64, fileName: file.name, title: title.trim() || undefined, notes: notes.trim() || undefined } });
      setResult(r);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import shot data"
      description="GSPro: Settings → Shot data → Export CSV. Most launch-monitor exports (Trackman, Mevo, Garmin, Rapsodo) work too."
      footer={result ? (
        <>
          <Link href={`/portal/swing/sessions/${result.session.id}`} className="inline-flex h-10 items-center rounded-apple-pill border border-apple-border bg-white px-5 text-apple-sm font-medium text-apple-text hover:bg-apple-fill-secondary">View session</Link>
          <Button onClick={onDone}>Done</Button>
        </>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!file}>Import</Button>
        </>
      )}
    >
      {result ? (
        <div className="space-y-4 text-apple-sm">
          <div className="rounded-apple-sm bg-apple-green/10 px-4 py-3 text-apple-green">
            Imported {result.session.shotCount} shots{result.planChanged ? " — your practice plan was updated." : "."}
          </div>
          {result.summary.clubs.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {result.summary.clubs.slice(0, 6).map((c) => <Stat key={c.club} label={c.club} value={c.carry ? `${n0(c.carry.mean)} yd` : "—"} hint={`${c.n} shots${c.smash != null ? ` · smash ${n1(c.smash)}` : ""}`} />)}
            </div>
          )}
          {result.summary.highlights.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-apple-text-secondary">{result.summary.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
          )}
          {result.summary.flags.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-apple-text">Flagged</div>
              <ul className="space-y-1 text-apple-text-secondary">{result.summary.flags.slice(0, 4).map((f) => <li key={`${f.key}-${f.club}`}>{f.club ? `${f.club}: ` : ""}{f.title}</li>)}</ul>
            </div>
          )}
          {result.unitNotes && result.unitNotes.length > 0 && <p className="text-apple-xs text-apple-text-tertiary">{result.unitNotes.join(" ")}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-apple-sm border-2 border-dashed border-apple-border p-6 text-center hover:bg-apple-fill-secondary/50">
            <FileUp className="h-6 w-6 text-apple-text-tertiary" />
            <span className="text-apple-sm font-medium text-apple-text">{file ? file.name : "Choose a CSV file"}</span>
            <span className="text-apple-xs text-apple-text-tertiary">{file ? `${(file.size / 1024).toFixed(0)} KB` : "or drag it here"}</span>
            <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <Input label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Wedge gapping, Tuesday" />
          <Textarea label="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error && <p className="text-apple-sm text-apple-red">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────────── Upload video ───────────────────────────── */

type CreateResp = { analysis: { id: string }; upload: { url: string; field: string; fields: Record<string, string>; limits: { maxSeconds: number; maxBytes: number } } };

function UploadVideoModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [club, setClub] = React.useState("");
  const [handedness, setHandedness] = React.useState<"RH" | "LH">("RH");
  const [view, setView] = React.useState<"auto" | "face_on" | "down_the_line">("auto");
  const [title, setTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [stage, setStage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { if (open) { setFile(null); setClub(""); setTitle(""); setError(null); setStage(null); } }, [open]);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setStage("Preparing…");
      const created = await api<CreateResp>("/api/portal/practice/swing", { method: "POST", json: { handedness, view, club: club.trim() || null, title: title.trim() || null, recordedAt: new Date(file.lastModified || Date.now()).toISOString() } });
      if (file.size > created.upload.limits.maxBytes) throw new Error(`Video is too large (${Math.round(created.upload.limits.maxBytes / 1024 / 1024)} MB max). Trim it to one swing.`);
      setStage("Uploading video…");
      const fd = new FormData();
      for (const [k, v] of Object.entries(created.upload.fields)) fd.append(k, v);
      fd.append(created.upload.field, file, file.name || "swing.mp4");
      const up = await fetch(created.upload.url, { method: "POST", body: fd });
      const upJson = (await up.json().catch(() => ({}))) as { job_id?: string; detail?: string };
      if (!up.ok || !upJson.job_id) throw new Error(upJson.detail || `Upload failed (HTTP ${up.status})`);
      setStage("Starting analysis…");
      await api(`/api/portal/practice/swing/${created.analysis.id}/uploaded`, { method: "POST", json: { jobId: upJson.job_id } });
      onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Analyze a swing video"
      description="Film one swing from face-on or down-the-line with your whole body in frame. Under 20 seconds."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!file}>{stage ?? "Upload & analyze"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-apple-sm border-2 border-dashed border-apple-border p-6 text-center hover:bg-apple-fill-secondary/50">
          <Video className="h-6 w-6 text-apple-text-tertiary" />
          <span className="text-apple-sm font-medium text-apple-text">{file ? file.name : "Choose a video"}</span>
          <span className="text-apple-xs text-apple-text-tertiary">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "MP4 or MOV"}</span>
          <input type="file" accept="video/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Handedness" value={handedness} onChange={(e) => setHandedness(e.target.value as "RH" | "LH")}>
            <option value="RH">Right-handed</option>
            <option value="LH">Left-handed</option>
          </Select>
          <Select label="Camera angle" value={view} onChange={(e) => setView(e.target.value as typeof view)}>
            <option value="auto">Detect automatically</option>
            <option value="face_on">Face on</option>
            <option value="down_the_line">Down the line</option>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Club (optional)" value={club} onChange={(e) => setClub(e.target.value)} placeholder="7 iron" />
          <Input label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Range, after lesson" />
        </div>
        {error && <p className="text-apple-sm text-apple-red">{error}</p>}
      </div>
    </Modal>
  );
}
