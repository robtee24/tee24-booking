// Video swing analysis: mint upload tickets for swinglab, track jobs, fold the
// resulting feedback into the member's practice plan.
import { randomBytes } from "node:crypto";
import { after } from "next/server";
import type { Prisma, SwingAnalysis } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mintUploadTicket, signFileUrl, signProThumbUrl, swinglab, swinglabConfig, TICKET_TTL_S, type SwinglabJob, type SwinglabPro, type SwinglabReport } from "@/lib/swinglab";
import { blobSize, blobUrl, deleteJob as deleteJobBlobs, jobPath, presignClipUpload, purgeJobFiles, purgeJobMedia, readJobRecord, SOURCE_CLIP, swingBlobEnabled } from "@/lib/swing-blob";
import { adminNotify } from "@/lib/admin-notify";
import type { FocusAreaKey } from "@/lib/practice/drills";
import type { SwingFlag } from "@/lib/practice/swing-analysis";
import { regeneratePlan } from "@/services/mobile-practice.service";
import { MobileError } from "@/services/mobile-auth.service";

/** Clips over 10 s or shot in slow motion (>60 fps) are turned away before any model work runs. */
export const SWING_LIMITS = { maxSeconds: 10, maxFps: 60, maxBytes: 60 * 1024 * 1024, ticketTtlS: TICKET_TTL_S };

/** Media retention: the source clip goes after a week, rendered videos after 90 idle days. Stills and the report stay. */
export const SWING_RETENTION = { clipDays: 7, videoIdleDays: 90 };

/** An UPLOADED row with no word from the analyzer for this long is written off. */
const RUNNING_TIMEOUT_MS = 20 * 60 * 1000;

function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://reservations.tee24.golf").replace(/\/$/, "");
}

/** Where the analyzer reports the camera angle and asks for the member's pro choice. */
const callbackUrl = (jobId: string) => `${appBaseUrl()}/api/swinglab/jobs/${encodeURIComponent(jobId)}`;

type Handedness = "RH" | "LH";
type View = "face_on" | "down_the_line" | "auto";

export type CreateSwingInput = {
  handedness?: Handedness | string | null;
  view?: View | string | null;
  club?: string | null;
  /** Pro bank swing id for the side-by-side; omit for the closest-tempo auto pick. */
  proId?: string | null;
  title?: string | null;
  notes?: string | null;
  recordedAt?: string | null;
};

/** swinglab feedback rule → plan focus area. */
const RULE_AREA: Record<string, FocusAreaKey> = {
  fast_tempo: "consistency",
  slow_tempo: "consistency",
  low_x_factor: "distance",
  insufficient_x_factor: "distance",
  insufficient_backswing_turn: "distance",
  excessive_backswing_turn: "consistency",
  head_sway_backswing: "iron_contact",
  head_drift_backswing_cohort: "iron_contact",
  reverse_pivot_address: "iron_contact",
  head_move_impact: "iron_contact",
  head_dip_cohort: "iron_contact",
  spine_loss: "iron_contact",
  early_extension_cohort: "iron_contact",
  lead_arm_collapse: "distance",
  lead_arm_collapse_abs: "distance",
  lead_arm_collapse_mid_backswing: "distance",
  knee_flex_lost_abs: "consistency",
  knee_flex_lost_top: "consistency",
  hip_stall_at_impact: "distance",
  hip_rotation_lagging_downswing: "distance",
  casting_wrist: "distance",
  wrist_hinge_lost_top: "distance",
  head_up_finish: "consistency",
};

const SEVERITY: Record<number, number> = { 1: 0.35, 2: 0.6, 3: 0.85 };

export function deriveFlags(report: SwinglabReport, club: string | null): SwingFlag[] {
  const seen = new Set<string>();
  const flags: SwingFlag[] = [];
  for (const f of report.feedback ?? []) {
    if (!f?.rule || seen.has(f.rule)) continue;
    seen.add(f.rule);
    flags.push({
      key: `video_${f.rule}`,
      area: RULE_AREA[f.rule] ?? "consistency",
      severity: SEVERITY[f.severity] ?? 0.5,
      club,
      title: f.title,
      detail: f.message,
      metric: f.metric,
    });
  }
  return flags.sort((a, b) => b.severity - a.severity);
}

/** 0–100 headline number for the card. Purely presentational. */
export function swingScore(report: SwinglabReport): number {
  const penalty = (report.feedback ?? []).reduce((a, f) => a + (f.severity === 3 ? 14 : f.severity === 2 ? 9 : 5), 0);
  const lowConf = report.source?.pose_low_confidence_ratio ?? 0;
  return Math.max(35, Math.min(99, Math.round(96 - penalty - lowConf * 20)));
}

/** Strip bulky arrays (club path, per-frame data) before storing. */
function compactReport(r: SwinglabReport): SwinglabReport {
  const { path: _path, ...club } = (r.club ?? {}) as SwinglabReport["club"] & { path?: unknown };
  return {
    format: r.format,
    version: r.version,
    source: r.source,
    view: r.view,
    handedness: r.handedness,
    phases: r.phases,
    club: club as SwinglabReport["club"],
    metrics: r.metrics,
    comparison: r.comparison ?? null,
    pro_reference: r.pro_reference ?? null,
    feedback: r.feedback ?? [],
    warnings: r.warnings ?? [],
    outputs: r.outputs ?? {},
  };
}

function cleanInput(input: CreateSwingInput) {
  const hand = String(input.handedness ?? "RH").toUpperCase();
  const handedness: Handedness = hand === "LH" || hand === "LEFT" ? "LH" : "RH";
  const v = String(input.view ?? "auto");
  const view: View = v === "face_on" || v === "down_the_line" ? v : "auto";
  const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
  if (Number.isNaN(recordedAt.getTime())) throw new MobileError("Invalid date", 400, "BAD_REQUEST");
  const proId = String(input.proId ?? "").trim();
  return {
    handedness,
    view,
    club: input.club?.trim().slice(0, 40) || null,
    proId: /^[A-Za-z0-9_\-]{1,80}$/.test(proId) ? proId : null,
    title: input.title?.trim().slice(0, 120) || null,
    notes: input.notes?.trim().slice(0, 2000) || null,
    recordedAt,
  };
}

export function swingServiceStatus() {
  const cfg = swinglabConfig();
  return { enabled: cfg.enabled, limits: SWING_LIMITS };
}

function requireEnabled() {
  if (!swinglabConfig().enabled) throw new MobileError("Swing analysis isn't available right now", 503, "SWING_UNAVAILABLE");
}

// ------------------------------------------------------------------ pro bank

const PRO_CACHE_TTL_MS = 5 * 60 * 1000;
let proCache: { at: number; pros: SwinglabPro[] } | null = null;

/** Every usable bank entry (unfiltered, un-mirrored), cached a few minutes.
 *  With Blob configured the listing comes off the CDN (`pros/index.json`,
 *  written by swing-analyzer/scripts/publish_bank.py) so the picker never
 *  waits on an analyzer cold start. */
async function allPros(): Promise<SwinglabPro[]> {
  if (proCache && Date.now() - proCache.at < PRO_CACHE_TTL_MS) return proCache.pros;
  let pros: SwinglabPro[];
  if (swingBlobEnabled()) {
    const res = await fetch(`${blobUrl("pros/index.json")}?t=${Math.floor(Date.now() / PRO_CACHE_TTL_MS)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`pro index ${res.status}`);
    pros = ((await res.json()) as { pros: SwinglabPro[] }).pros;
  } else {
    pros = (await swinglab.listPros()).pros;
  }
  proCache = { at: Date.now(), pros };
  return pros;
}

export type ProOption = {
  id: string;
  player: string;
  view: "face_on" | "down_the_line";
  /** The pro's own handedness. */
  handedness: "RH" | "LH";
  /** True when the clip will be flipped so it matches the member's handedness. */
  mirrored: boolean;
  club: string;
  tempo: number;
  thumbnail: string | null;
  source: { url: string; title: string } | null;
};

/**
 * Pros the member can pick for the side-by-side, filtered to their camera view
 * and annotated with whether each clip will be mirrored for their handedness.
 */
export async function listPros(input: { view?: string | null; handedness?: string | null }) {
  if (!swinglabConfig().enabled) return { enabled: false, pros: [] as ProOption[], players: [] as string[] };
  const view = input.view === "face_on" || input.view === "down_the_line" ? input.view : null;
  const hand = String(input.handedness ?? "RH").toUpperCase();
  const mine: Handedness = hand === "LH" || hand === "LEFT" ? "LH" : "RH";
  const pros = (await allPros())
    .filter((p) => p.has_video && (p.view === "face_on" || p.view === "down_the_line") && (!view || p.view === view))
    .map<ProOption>((p) => {
      const theirs: "RH" | "LH" = p.handedness === "left" ? "LH" : "RH";
      return {
        id: p.swing_id,
        player: p.player,
        view: p.view as "face_on" | "down_the_line",
        handedness: theirs,
        mirrored: theirs !== mine,
        club: p.club,
        tempo: p.tempo,
        thumbnail: p.has_thumb ? signProThumbUrl(p.swing_id) : null,
        source: p.source_url ? { url: p.source_url, title: p.source_title || p.source_url } : null,
      };
    })
    .sort((a, b) => a.player.localeCompare(b.player) || a.view.localeCompare(b.view));
  return { enabled: true, pros, players: Array.from(new Set(pros.map((p) => p.player))) };
}

/** Step 1: create the record and hand the phone an upload ticket. */
export async function createAnalysis(memberId: string, input: CreateSwingInput) {
  requireEnabled();
  const data = cleanInput(input);
  if (data.proId) {
    const known = (await allPros().catch(() => [] as SwinglabPro[])).some((p) => p.swing_id === data.proId);
    if (!known) data.proId = null;
  }
  // Blob flow: the job id is ours, so the clip's path is known before the upload.
  const jobId = swingBlobEnabled() ? randomBytes(16).toString("hex") : undefined;
  const analysis = await prisma.swingAnalysis.create({ data: { memberId, status: "PENDING", jobId, ...data } });
  // The member's declared handedness is a profile fact; keep the practice
  // profile in sync so every later upload and plan uses it.
  if (input.handedness != null) {
    await prisma.practiceProfile
      .updateMany({ where: { memberId, NOT: { handedness: data.handedness } }, data: { handedness: data.handedness } })
      .catch(() => null);
  }
  if (jobId) {
    const up = await presignClipUpload(jobId, SWING_LIMITS.maxBytes, TICKET_TTL_S);
    return {
      analysis: present(analysis),
      upload: { url: up.url, method: up.method, field: "video", fields: {}, headers: up.headers, expiresAt: up.expiresAt, limits: SWING_LIMITS },
    };
  }
  const { ticket, expiresAt } = mintUploadTicket(analysis.id);
  const { publicBase } = swinglabConfig();
  return {
    analysis: present(analysis),
    upload: {
      url: `${publicBase}/analyze`,
      method: "POST" as const,
      field: "video",
      fields: {
        ticket,
        handedness: data.handedness === "LH" ? "left" : "right",
        view: data.view,
        compare: "true",
        render: "true",
        // Read the camera angle up front and leave the you-vs-pro cut until
        // last so the member can pick a pro while the analysis runs.
        detect_view: "true",
        defer_pro: "true",
        ...(data.proId ? { pro_id: data.proId } : {}),
      },
      headers: {},
      expiresAt,
      limits: SWING_LIMITS,
    },
  };
}

/**
 * Step 2: the phone finished the upload.
 *
 * Blob flow: the clip is in Blob under our job id; verify it landed, then run
 * the analysis after the response goes out (`after()` keeps this function
 * alive for the route's `maxDuration`). Ticket flow: the phone hands us the
 * swinglab job id it was given.
 */
export async function markUploaded(memberId: string, id: string, jobId: string | undefined, detectedView?: string | null) {
  const a = await prisma.swingAnalysis.findFirst({ where: { id, memberId } });
  if (!a) throw new MobileError("Analysis not found", 404, "NOT_FOUND");
  if (swingBlobEnabled() && a.jobId) {
    if (a.status === "UPLOADED" || a.status === "DONE") return { analysis: present(a) };
    const size = await blobSize(jobPath(a.jobId, SOURCE_CLIP));
    if (!size) throw new MobileError("The video didn't finish uploading. Try again.", 409, "UPLOAD_MISSING");
    if (size > SWING_LIMITS.maxBytes) throw new MobileError(`That video is too large. Trim it to one swing under ${SWING_LIMITS.maxSeconds} seconds.`, 413, "TOO_LARGE");
    const updated = await prisma.swingAnalysis.update({ where: { id: a.id }, data: { status: "UPLOADED", error: null, completedAt: null } });
    after(() => runAnalysis(updated.id));
    return { analysis: present(updated) };
  }
  if (!jobId || !/^[a-f0-9]{6,64}$/i.test(jobId)) throw new MobileError("Missing job id", 400, "BAD_REQUEST");
  const updated = await prisma.swingAnalysis.update({
    where: { id: a.id },
    data: { status: "UPLOADED", jobId, error: null, detectedView: cleanView(detectedView) },
  });
  const fresh = await refresh(updated).catch(() => updated);
  return { analysis: present(fresh) };
}

/** Hosted analyzer: one synchronous call does the whole job. Runs inside `after()`. */
async function runAnalysis(id: string) {
  const a = await prisma.swingAnalysis.findUnique({ where: { id } });
  if (!a?.jobId || a.status !== "UPLOADED") return;
  try {
    const job = await swinglab.analyzeAndWait({
      jobId: a.jobId,
      videoUrl: blobUrl(jobPath(a.jobId, SOURCE_CLIP)),
      handedness: a.handedness === "LH" ? "left" : "right",
      view: a.view === "face_on" || a.view === "down_the_line" ? a.view : "auto",
      proId: a.proId,
      callbackUrl: callbackUrl(a.jobId),
    });
    await settle(a, job);
  } catch (err) {
    await failed(a.id, err);
  }
}

/** Hosted analyzer: re-cut the side-by-side against another pro. Runs inside `after()`. */
async function runRecompare(id: string, proId: string) {
  const a = await prisma.swingAnalysis.findUnique({ where: { id } });
  if (!a?.jobId || a.status !== "UPLOADED") return;
  try {
    const job = await swinglab.recompare(a.jobId, proId, { wait: true });
    await settle(a, job);
  } catch (err) {
    await failed(a.id, err);
  }
}

async function settle(a: SwingAnalysis, job: SwinglabJob) {
  if (job.status === "done" && job.report) {
    await applyReport(a, job);
    return;
  }
  if (job.status === "error" || job.status === "done") {
    await prisma.swingAnalysis.updateMany({
      where: { id: a.id, status: "UPLOADED" },
      data: { status: "ERROR", error: friendlyError(job.error), seconds: job.seconds ?? null, completedAt: new Date() },
    });
  }
  // Still "running" (analyzer answered early): refresh() picks it up from job.json.
}

async function failed(id: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn("[swing] analysis call failed", msg);
  const friendly = /abort|timeout|timed out/i.test(msg)
    ? "The analysis took too long. Try a shorter clip."
    : friendlyError(msg.replace(/^swinglab \d+: /, ""));
  const r = await prisma.swingAnalysis.updateMany({ where: { id, status: "UPLOADED" }, data: { status: "ERROR", error: friendly, completedAt: new Date() } });
  if (r.count) await alertSwingFailure(id, msg, friendly);
}

/** Clip rejections are the member's to fix; anything else is ours and lands in the admin inbox. */
function isClipRejection(raw: string) {
  return /CLIP_TOO_LONG|CLIP_SLOW_MOTION|CLIP_TOO_SHORT|too short to analyze/i.test(raw);
}

async function alertSwingFailure(id: string, raw: string, friendly: string) {
  try {
    const a = await prisma.swingAnalysis.findUnique({ where: { id }, include: { member: { select: { firstName: true, lastName: true, organizationId: true, locationId: true } } } });
    if (!a) return;
    const who = `${a.member.firstName} ${a.member.lastName}`.trim();
    const link = `/admin/locations/${a.member.locationId}/members/list/${a.memberId}`;
    const common = { organizationId: a.member.organizationId, locationId: a.member.locationId, link, data: { analysisId: a.id, jobId: a.jobId, error: raw.slice(0, 500) } };
    if (isClipRejection(raw)) {
      await adminNotify({ ...common, kind: "swinglab.rejected", severity: "INFO", title: `Swing Lab turned away a clip from ${who}`, body: friendly });
      return;
    }
    await adminNotify({ ...common, kind: "swinglab.failed", severity: "ERROR", title: `Swing Lab analysis failed for ${who}`, body: `${friendly} (${raw.slice(0, 200)})` });
    // Several real failures in a short window usually means the analyzer itself is unwell.
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const recent = await prisma.adminNotification.count({ where: { kind: "swinglab.failed", createdAt: { gte: since } } });
    const rolled = await prisma.adminNotification.count({ where: { kind: "swinglab.burst", createdAt: { gte: since } } });
    if (recent >= 3 && rolled === 0) {
      await adminNotify({ ...common, kind: "swinglab.burst", severity: "ERROR", title: `Swing Lab: ${recent} analyses failed in the last 15 minutes`, body: "Check the analyzer (tee24-swinglab on Vercel) and its runtime logs.", link: "/admin/notifications" });
    }
  } catch (e) {
    console.warn("[swing] alert failed", e instanceof Error ? e.message : e);
  }
}

/** Analyzer callback: the camera angle read off the clip right after it landed. */
export async function recordDetectedView(jobId: string, detectedView: string | null | undefined) {
  const dv = cleanView(detectedView);
  if (!dv) return false;
  const r = await prisma.swingAnalysis.updateMany({ where: { jobId, status: "UPLOADED" }, data: { detectedView: dv } });
  return r.count > 0;
}

/** Analyzer callback: the pro the member wants right now (`""` = best match). */
export async function currentProChoice(jobId: string) {
  const a = await prisma.swingAnalysis.findFirst({ where: { jobId }, select: { proId: true } });
  return a ? { pro_id: a.proId ?? "" } : null;
}

export async function listAnalyses(memberId: string, limit = 30) {
  const rows = await prisma.swingAnalysis.findMany({
    where: { memberId },
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, limit)),
  });
  // Refresh a few in-flight jobs so the list reflects progress without a per-row fetch.
  const pending = rows.filter((r) => r.status === "UPLOADED" || r.status === "PENDING").slice(0, 4);
  const refreshed = await Promise.all(pending.map((r) => refresh(r).catch(() => r)));
  const byId = new Map(refreshed.map((r) => [r.id, r]));
  return {
    ...swingServiceStatus(),
    analyses: rows.map((r) => summary(byId.get(r.id) ?? r)),
  };
}

export async function getAnalysis(memberId: string, id: string) {
  const a = await prisma.swingAnalysis.findFirst({ where: { id, memberId } });
  if (!a) throw new MobileError("Analysis not found", 404, "NOT_FOUND");
  // Opening a swing keeps its videos alive (see SWING_RETENTION); throttle the write to once an hour.
  if (!a.lastOpenedAt || Date.now() - a.lastOpenedAt.getTime() > 60 * 60 * 1000) {
    void prisma.swingAnalysis.update({ where: { id: a.id }, data: { lastOpenedAt: new Date() } }).catch(() => {});
  }
  const fresh = await refresh(a).catch((err) => {
    console.warn("[swing] refresh failed", err instanceof Error ? err.message : err);
    return a;
  });
  return { analysis: present(fresh) };
}

/** Re-run you-vs-pro on the stored clip against a different reference. */
/**
 * Re-run you-vs-pro on the stored clip against a different reference.
 * Works while the analysis is still running too — swinglab queues the choice
 * and cuts the side-by-side against it once the body tracking is done.
 * `proId` of "auto" asks for the best match.
 */
export async function recompareAnalysis(memberId: string, id: string, proId: string) {
  const a = await prisma.swingAnalysis.findFirst({ where: { id, memberId } });
  if (!a) throw new MobileError("Analysis not found", 404, "NOT_FOUND");
  if ((a.status !== "DONE" && a.status !== "UPLOADED") || !a.jobId) throw new MobileError("This clip isn't ready to compare yet", 409, "NOT_READY");
  if (!swinglabConfig().enabled) throw new MobileError("Swing analysis is offline right now", 503, "SWINGLAB_OFFLINE");
  const clean = proId.trim();
  const auto = clean === "" || clean === "auto";
  if (!auto && !/^[A-Za-z0-9_\-]{1,80}$/.test(clean)) throw new MobileError("Choose a pro", 400, "BAD_REQUEST");
  if (!auto) {
    const known = (await allPros().catch(() => [] as SwinglabPro[])).some((p) => p.swing_id === clean);
    if (!known) throw new MobileError("That pro isn't in the library", 404, "UNKNOWN_PRO");
  }
  if (swingBlobEnabled()) {
    if (a.status === "UPLOADED") {
      // Still running: the worker asks us for the current choice before it cuts the side-by-side.
      const updated = await prisma.swingAnalysis.update({ where: { id: a.id }, data: { proId: auto ? null : clean } });
      return { analysis: present(updated) };
    }
    if (!(await blobSize(jobPath(a.jobId, SOURCE_CLIP)))) {
      // Retention or the member removed the server copy; the phone keeps the original.
      const up = await presignClipUpload(a.jobId, SWING_LIMITS.maxBytes, TICKET_TTL_S);
      throw new MobileError("Send the clip from this phone so the new comparison can be rendered.", 409, "CLIP_GONE", {
        upload: { url: up.url, method: up.method, field: "video", fields: {}, headers: up.headers, expiresAt: up.expiresAt.toISOString(), limits: SWING_LIMITS },
      });
    }
    const updated = await prisma.swingAnalysis.update({
      where: { id: a.id },
      data: { status: "UPLOADED", proId: auto ? null : clean, error: null, completedAt: null, clipPurgedAt: null, mediaPurgedAt: null },
    });
    after(() => runRecompare(updated.id, auto ? "auto" : clean));
    return { analysis: present(updated) };
  }
  try {
    await swinglab.recompare(a.jobId, auto ? "auto" : clean);
  } catch (err) {
    const status = (err as { status?: number }).status;
    const message = err instanceof Error ? err.message : "Couldn't start the comparison";
    if (status === 409) {
      const { ticket, expiresAt } = mintUploadTicket(a.id);
      const { publicBase } = swinglabConfig();
      throw new MobileError("Send the clip from this phone so the new comparison can be rendered.", 409, "CLIP_GONE", {
        upload: {
          url: `${publicBase}/jobs/${a.jobId}/source`,
          method: "POST",
          field: "video",
          fields: { ticket },
          expiresAt: expiresAt.toISOString(),
          limits: SWING_LIMITS,
        },
      });
    }
    throw new MobileError(message.replace(/^swinglab \d+: /, ""), status && status >= 400 && status < 600 ? status : 502, "RECOMPARE_FAILED");
  }
  const updated = await prisma.swingAnalysis.update({
    where: { id: a.id },
    data: { status: "UPLOADED", proId: auto ? null : clean, error: null, completedAt: null },
  });
  return { analysis: present(updated) };
}

function knownView(v: string | null | undefined): string | null {
  return v === "face_on" || v === "down_the_line" ? v : null;
}

function cleanView(v: string | null | undefined): string | null {
  return v === "face_on" || v === "down_the_line" || v === "unknown" ? v : null;
}

/** The phone has the videos. Remove them from the analysis machine. */
export async function purgeAnalysisMedia(memberId: string, id: string) {
  const a = await prisma.swingAnalysis.findFirst({ where: { id, memberId } });
  if (!a) throw new MobileError("Analysis not found", 404, "NOT_FOUND");
  if (a.jobId && swingBlobEnabled()) await purgeJobMedia(a.jobId).catch((err) => console.warn("[swing] purge failed", err));
  else if (a.jobId && swinglabConfig().enabled) await swinglab.purgeMedia(a.jobId);
  return { purged: true };
}

export async function deleteAnalysis(memberId: string, id: string) {
  const a = await prisma.swingAnalysis.findFirst({ where: { id, memberId } });
  if (!a) throw new MobileError("Analysis not found", 404, "NOT_FOUND");
  if (a.jobId && swingBlobEnabled()) await deleteJobBlobs(a.jobId).catch((err) => console.warn("[swing] delete failed", err));
  else if (a.jobId && swinglabConfig().enabled) await swinglab.deleteJob(a.jobId);
  await prisma.$transaction(async (tx) => {
    await tx.swingAnalysis.delete({ where: { id: a.id } });
    if (a.sessionId) await tx.practiceSession.deleteMany({ where: { id: a.sessionId, memberId } });
  });
  if (a.sessionId && (await prisma.practiceProfile.count({ where: { memberId } }))) await regeneratePlan(memberId, "import").catch(() => null);
  return { deleted: true };
}

/** Pull job state from swinglab if the analysis is still in flight. */
async function refresh(a: SwingAnalysis): Promise<SwingAnalysis> {
  if (a.status === "PENDING") {
    const age = Date.now() - a.createdAt.getTime();
    if (age > (TICKET_TTL_S + 10 * 60) * 1000) {
      return prisma.swingAnalysis.update({ where: { id: a.id }, data: { status: "EXPIRED", error: "Upload never finished" } });
    }
    return a;
  }
  if (a.status !== "UPLOADED" || !a.jobId) return a;
  if (!swinglabConfig().enabled) return a;

  if (swingBlobEnabled()) {
    // The `after()` worker normally lands the result. This is the backstop
    // for a backend instance that went away mid-job: the analyzer publishes
    // job.json to Blob regardless of who is listening.
    const job = await readJobRecord<SwinglabJob>(a.jobId).catch(() => null);
    if (job?.status === "done" && job.report) return applyReport(a, job);
    if (job?.status === "error") {
      return prisma.swingAnalysis.update({
        where: { id: a.id },
        data: { status: "ERROR", error: friendlyError(job.error), seconds: job.seconds ?? null, completedAt: new Date() },
      });
    }
    const dv = cleanView(job?.detected_view);
    if (dv && dv !== a.detectedView) return prisma.swingAnalysis.update({ where: { id: a.id }, data: { detectedView: dv } });
    if (Date.now() - a.updatedAt.getTime() > RUNNING_TIMEOUT_MS) {
      return prisma.swingAnalysis.update({
        where: { id: a.id },
        data: { status: "ERROR", error: "The analysis took too long. Try a shorter clip.", completedAt: new Date() },
      });
    }
    return a;
  }

  let job: SwinglabJob;
  try {
    job = await swinglab.getJob(a.jobId);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return prisma.swingAnalysis.update({ where: { id: a.id }, data: { status: "ERROR", error: "The analysis job was not found", completedAt: new Date() } });
    }
    throw err;
  }
  if (job.status === "running") {
    const dv = cleanView(job.detected_view);
    if (dv && dv !== a.detectedView) return prisma.swingAnalysis.update({ where: { id: a.id }, data: { detectedView: dv } });
    return a;
  }
  if (job.status === "error" || !job.report) {
    return prisma.swingAnalysis.update({
      where: { id: a.id },
      data: { status: "ERROR", error: friendlyError(job.error), seconds: job.seconds ?? null, completedAt: new Date() },
    });
  }
  return applyReport(a, job);
}

function friendlyError(raw: string | undefined) {
  const s = raw ?? "Analysis failed";
  if (/no pose|pose_low_confidence|could not detect/i.test(s)) return "We couldn't see a full body in the clip. Film the whole swing with your body in frame.";
  if (/CLIP_SLOW_MOTION/.test(s)) return "Slow-motion clips aren't supported. Record at normal speed and try again.";
  if (/CLIP_TOO_LONG/.test(s)) return `That clip is over ${SWING_LIMITS.maxSeconds} seconds. Trim it to one swing in Photos and try again.`;
  if (/too short/i.test(s)) return "That clip is too short to analyze. Film the whole swing, address to finish.";
  if (/too long|duration/i.test(s)) return `The clip is too long. Trim it to one swing (under ${SWING_LIMITS.maxSeconds} seconds).`;
  return s.replace(/^[A-Za-z]+Error:\s*/, "").slice(0, 300);
}

/** Store the compact report, derive flags, mirror into a PracticeSession, re-tune the plan. */
async function applyReport(a: SwingAnalysis, job: SwinglabJob): Promise<SwingAnalysis> {
  const report = compactReport(job.report as SwinglabReport);
  const flags = deriveFlags(report, a.club);
  const score = swingScore(report);
  const highlights = buildHighlights(report);
  const sessionSummary = { shots: 1, clubs: [], flags, highlights, source: "SWING_VIDEO", swingAnalysisId: a.id, score };

  const updated = await prisma.$transaction(async (tx) => {
    // The after() worker and a concurrent refresh() can both see "done".
    const cur = await tx.swingAnalysis.findUnique({ where: { id: a.id } });
    if (!cur) return a;
    if (cur.status === "DONE" && cur.report && cur.completedAt && cur.completedAt > a.updatedAt) return cur;
    const session = cur.sessionId
      ? await tx.practiceSession.update({ where: { id: cur.sessionId }, data: { summary: sessionSummary as unknown as Prisma.InputJsonValue, shotCount: 1 } })
      : await tx.practiceSession.create({
          data: {
            memberId: a.memberId,
            source: "SWING_VIDEO",
            playedAt: a.recordedAt,
            title: a.title ?? `Swing video${a.club ? ` · ${a.club}` : ""}`,
            notes: a.notes,
            shotCount: 1,
            summary: sessionSummary as unknown as Prisma.InputJsonValue,
          },
        });
    return tx.swingAnalysis.update({
      where: { id: a.id },
      data: {
        status: "DONE",
        sessionId: session.id,
        report: report as unknown as Prisma.InputJsonValue,
        flags: flags as unknown as Prisma.InputJsonValue,
        seconds: job.seconds ?? null,
        error: null,
        completedAt: new Date(),
        clipPurgedAt: null,
        mediaPurgedAt: null,
      },
    });
  });
  if (await prisma.practiceProfile.count({ where: { memberId: a.memberId } })) {
    await regeneratePlan(a.memberId, "import").catch((err) => console.warn("[swing] plan regen failed", err));
  }
  return updated;
}

function metric(report: SwinglabReport, name: string) {
  return report.metrics?.summary?.find((m) => m.name === name) ?? null;
}

function buildHighlights(report: SwinglabReport): string[] {
  const out: string[] = [];
  const tempo = metric(report, "tempo_ratio");
  if (tempo?.value != null && tempo.value >= 2.7 && tempo.value <= 3.3) out.push(`Tempo ${tempo.value.toFixed(1)}:1 — right in the tour window.`);
  const xf = metric(report, "x_factor_top_deg");
  if (xf?.value != null && xf.value >= 35) out.push(`X-factor ${Math.round(xf.value)}° at the top — plenty of stored power.`);
  const head = metric(report, "head_move_impact_pct");
  if (head?.value != null && head.value < 5) out.push("Head stays centered into impact.");
  const spine = metric(report, "spine_angle_change_deg");
  if (spine?.value != null && Math.abs(spine.value) < 8) out.push("Posture held from address to impact.");
  return out.slice(0, 4);
}

// ----------------------------------------------------------------- presenters

const PHASE_ORDER = ["ADDRESS", "TOE_UP", "MID_BACKSWING", "TOP", "MID_DOWNSWING", "IMPACT", "MID_FOLLOW_THROUGH", "FINISH"];

function assets(a: SwingAnalysis) {
  const report = a.report as SwinglabReport | null;
  if (!a.jobId || !report?.outputs || !swinglabConfig().enabled) return null;
  const o = report.outputs;
  const str = (k: string) => (typeof o[k] === "string" ? signFileUrl(a.jobId!, o[k] as string) : null);
  const stills = (o.stills && typeof o.stills === "object" ? o.stills : {}) as Record<string, string>;
  const video = (k: string) => (a.mediaPurgedAt ? null : str(k));
  return {
    annotatedVideo: video("annotated_video"),
    clubPathVideo: video("club_path_video"),
    clubCompareVideo: video("club_compare_video"),
    sideBySideVideo: video("side_by_side_video"),
    phaseGrid: str("phase_grid"),
    wristPlot: str("wrist_plot"),
    stills: Object.fromEntries(
      Object.entries(stills)
        .sort(([x], [y]) => PHASE_ORDER.indexOf(x) - PHASE_ORDER.indexOf(y))
        .map(([k, v]) => [k, signFileUrl(a.jobId!, v)]),
    ),
  };
}

function proReference(report: SwinglabReport | null) {
  const r = report?.pro_reference;
  if (!r || typeof r !== "object" || !r.swing_id) return null;
  return {
    id: r.swing_id,
    player: r.player || r.swing_id,
    view: r.view,
    handedness: r.handedness === "left" ? ("LH" as const) : ("RH" as const),
    mirrored: Boolean(r.mirrored),
    club: r.club,
    source: r.source_url ? { url: r.source_url, title: r.source_title || r.source_url } : null,
  };
}

function base(a: SwingAnalysis) {
  const report = a.report as SwinglabReport | null;
  return {
    id: a.id,
    status: a.status as "PENDING" | "UPLOADED" | "DONE" | "ERROR" | "EXPIRED",
    handedness: a.handedness,
    view: a.view,
    club: a.club,
    proId: a.proId,
    proReference: proReference(report),
    title: a.title,
    notes: a.notes,
    error: a.error,
    seconds: a.seconds,
    recordedAt: a.recordedAt,
    completedAt: a.completedAt,
    createdAt: a.createdAt,
    sessionId: a.sessionId,
    score: report ? swingScore(report) : null,
    detectedView: knownView(report?.metrics?.view) ?? knownView(report?.view) ?? a.detectedView ?? null,
    /** Rendered videos were removed after 90 idle days; stills and feedback remain. */
    videosExpired: !!a.mediaPurgedAt,
  };
}

function summary(a: SwingAnalysis) {
  const report = a.report as SwinglabReport | null;
  const as = assets(a);
  return {
    ...base(a),
    thumbnail: as?.stills?.IMPACT ?? as?.stills?.TOP ?? as?.stills?.ADDRESS ?? null,
    topFeedback: (report?.feedback ?? []).slice(0, 2).map((f) => ({ rule: f.rule, title: f.title, severity: f.severity })),
    feedbackCount: report?.feedback?.length ?? 0,
  };
}

function present(a: SwingAnalysis) {
  const report = a.report as SwinglabReport | null;
  return {
    ...base(a),
    flags: (a.flags as SwingFlag[] | null) ?? [],
    assets: assets(a),
    report: report
      ? {
          source: report.source,
          view: report.view,
          handedness: report.handedness,
          phases: report.phases,
          club: report.club,
          metrics: report.metrics,
          feedback: report.feedback,
          warnings: report.warnings,
          highlights: buildHighlights(report),
        }
      : null,
  };
}

// ----------------------------------------------------------------- retention

/**
 * Nightly: drop source clips a week after the analysis finished, and rendered
 * videos once nobody has opened the swing in 90 days. Stills, the report and the
 * pose cache stay, so the swing still reads fine in the app; a pro swap after
 * this asks the phone for the clip again.
 */
export async function runSwingRetention(now = new Date()) {
  if (!swingBlobEnabled()) return { clips: 0, videos: 0, skipped: "blob disabled" as const };
  const day = 24 * 60 * 60 * 1000;
  const clipCutoff = new Date(now.getTime() - SWING_RETENTION.clipDays * day);
  const videoCutoff = new Date(now.getTime() - SWING_RETENTION.videoIdleDays * day);
  let clips = 0;
  let videos = 0;

  const staleVideos = await prisma.swingAnalysis.findMany({
    where: {
      status: { in: ["DONE", "ERROR"] },
      jobId: { not: null },
      mediaPurgedAt: null,
      completedAt: { lt: videoCutoff },
      OR: [{ lastOpenedAt: null }, { lastOpenedAt: { lt: videoCutoff } }],
    },
    select: { id: true, jobId: true },
    take: 200,
  });
  for (const a of staleVideos) {
    try {
      await purgeJobFiles(a.jobId!, "videos");
      await prisma.swingAnalysis.update({ where: { id: a.id }, data: { mediaPurgedAt: now, clipPurgedAt: now } });
      videos++;
    } catch (err) {
      console.warn("[swing] retention (videos) failed", a.id, err instanceof Error ? err.message : err);
    }
  }

  const staleClips = await prisma.swingAnalysis.findMany({
    where: { status: { in: ["DONE", "ERROR"] }, jobId: { not: null }, clipPurgedAt: null, completedAt: { lt: clipCutoff } },
    select: { id: true, jobId: true },
    take: 500,
  });
  for (const a of staleClips) {
    try {
      await purgeJobFiles(a.jobId!, "clip");
      await prisma.swingAnalysis.update({ where: { id: a.id }, data: { clipPurgedAt: now } });
      clips++;
    } catch (err) {
      console.warn("[swing] retention (clip) failed", a.id, err instanceof Error ? err.message : err);
    }
  }
  return { clips, videos };
}

// ----------------------------------------------------------------- health watch

const HEALTH_KIND_DOWN = "integration.alert";
const HEALTH_KIND_UP = "integration.recovered";
const HEALTH_TAG = "swinglab-health";

/**
 * Every 10 minutes: probe the analyzer. One inbox alert when it stops
 * answering, one when it comes back — not one per tick.
 */
export async function checkSwinglabHealth() {
  if (!swinglabConfig().enabled) return { skipped: "disabled" as const };
  let up = false;
  let detail = "";
  try {
    const h = await swinglab.health();
    up = h.status === "ok";
    detail = up ? "" : `status=${h.status}`;
  } catch (err) {
    detail = err instanceof Error ? err.message : String(err);
  }
  const last = await prisma.adminNotification.findFirst({
    where: { kind: { in: [HEALTH_KIND_DOWN, HEALTH_KIND_UP] }, data: { path: ["tag"], equals: HEALTH_TAG } },
    orderBy: { createdAt: "desc" },
    select: { kind: true },
  });
  const wasDown = last?.kind === HEALTH_KIND_DOWN;
  if (!up && !wasDown) {
    await adminNotify({ kind: HEALTH_KIND_DOWN, severity: "ERROR", title: "Swing Lab analyzer is not responding", body: `Members can't analyze swings until it's back. ${detail}`.trim(), link: "/admin/notifications", data: { tag: HEALTH_TAG, detail } });
  } else if (up && wasDown) {
    await adminNotify({ kind: HEALTH_KIND_UP, severity: "INFO", title: "Swing Lab analyzer is back", body: "Health check passing again.", data: { tag: HEALTH_TAG } });
  }
  return { up, changed: up === wasDown };
}
