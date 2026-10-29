// Video swing analysis: mint upload tickets for swinglab, track jobs, fold the
// resulting feedback into the member's practice plan.
import type { Prisma, SwingAnalysis } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mintUploadTicket, signFileUrl, signProThumbUrl, swinglab, swinglabConfig, TICKET_TTL_S, type SwinglabJob, type SwinglabPro, type SwinglabReport } from "@/lib/swinglab";
import type { FocusAreaKey } from "@/lib/practice/drills";
import type { SwingFlag } from "@/lib/practice/swing-analysis";
import { regeneratePlan } from "@/services/mobile-practice.service";
import { MobileError } from "@/services/mobile-auth.service";

export const SWING_LIMITS = { maxSeconds: 20, maxBytes: 120 * 1024 * 1024, ticketTtlS: TICKET_TTL_S };

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

/** Every usable bank entry (unfiltered, un-mirrored), cached a few minutes. */
async function allPros(): Promise<SwinglabPro[]> {
  if (proCache && Date.now() - proCache.at < PRO_CACHE_TTL_MS) return proCache.pros;
  const { pros } = await swinglab.listPros();
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
  const analysis = await prisma.swingAnalysis.create({ data: { memberId, status: "PENDING", ...data } });
  // The member's declared handedness is a profile fact; keep the practice
  // profile in sync so every later upload and plan uses it.
  if (input.handedness != null) {
    await prisma.practiceProfile
      .updateMany({ where: { memberId, NOT: { handedness: data.handedness } }, data: { handedness: data.handedness } })
      .catch(() => null);
  }
  const { ticket, expiresAt } = mintUploadTicket(analysis.id);
  const { publicBase } = swinglabConfig();
  return {
    analysis: present(analysis),
    upload: {
      url: `${publicBase}/analyze`,
      method: "POST",
      field: "video",
      fields: {
        ticket,
        handedness: data.handedness === "LH" ? "left" : "right",
        view: data.view,
        compare: "true",
        render: "true",
        ...(data.proId ? { pro_id: data.proId } : {}),
      },
      expiresAt,
      limits: SWING_LIMITS,
    },
  };
}

/** Step 2: the phone finished the upload and has a swinglab job id. */
export async function markUploaded(memberId: string, id: string, jobId: string | undefined) {
  const a = await prisma.swingAnalysis.findFirst({ where: { id, memberId } });
  if (!a) throw new MobileError("Analysis not found", 404, "NOT_FOUND");
  if (!jobId || !/^[a-f0-9]{6,64}$/i.test(jobId)) throw new MobileError("Missing job id", 400, "BAD_REQUEST");
  const updated = await prisma.swingAnalysis.update({ where: { id: a.id }, data: { status: "UPLOADED", jobId, error: null } });
  const fresh = await refresh(updated).catch(() => updated);
  return { analysis: present(fresh) };
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
  const fresh = await refresh(a).catch((err) => {
    console.warn("[swing] refresh failed", err instanceof Error ? err.message : err);
    return a;
  });
  return { analysis: present(fresh) };
}

/** Re-run you-vs-pro on the stored clip against a different reference. */
export async function recompareAnalysis(memberId: string, id: string, proId: string) {
  const a = await prisma.swingAnalysis.findFirst({ where: { id, memberId } });
  if (!a) throw new MobileError("Analysis not found", 404, "NOT_FOUND");
  if (a.status !== "DONE" || !a.jobId) throw new MobileError("This clip isn't ready to compare yet", 409, "NOT_READY");
  if (!swinglabConfig().enabled) throw new MobileError("Swing analysis is offline right now", 503, "SWINGLAB_OFFLINE");
  const clean = proId.trim();
  if (!/^[A-Za-z0-9_\-]{1,80}$/.test(clean)) throw new MobileError("Choose a pro", 400, "BAD_REQUEST");
  const known = (await allPros().catch(() => [] as SwinglabPro[])).some((p) => p.swing_id === clean);
  if (!known) throw new MobileError("That pro isn't in the library", 404, "UNKNOWN_PRO");
  try {
    await swinglab.recompare(a.jobId, clean);
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
    data: { status: "UPLOADED", proId: clean, error: null, completedAt: null },
  });
  return { analysis: present(updated) };
}

/** The phone has the videos. Remove them from the analysis machine. */
export async function purgeAnalysisMedia(memberId: string, id: string) {
  const a = await prisma.swingAnalysis.findFirst({ where: { id, memberId } });
  if (!a) throw new MobileError("Analysis not found", 404, "NOT_FOUND");
  if (a.jobId && swinglabConfig().enabled) await swinglab.purgeMedia(a.jobId);
  return { purged: true };
}

export async function deleteAnalysis(memberId: string, id: string) {
  const a = await prisma.swingAnalysis.findFirst({ where: { id, memberId } });
  if (!a) throw new MobileError("Analysis not found", 404, "NOT_FOUND");
  if (a.jobId && swinglabConfig().enabled) await swinglab.deleteJob(a.jobId);
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
  if (job.status === "running") return a;
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
  if (/too (long|short)|duration/i.test(s)) return "The clip is too long. Trim it to one swing (under 20 seconds).";
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
    const session = a.sessionId
      ? await tx.practiceSession.update({ where: { id: a.sessionId }, data: { summary: sessionSummary as unknown as Prisma.InputJsonValue, shotCount: 1 } })
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
  return {
    annotatedVideo: str("annotated_video"),
    clubPathVideo: str("club_path_video"),
    clubCompareVideo: str("club_compare_video"),
    sideBySideVideo: str("side_by_side_video"),
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
    detectedView: report?.metrics?.view ?? report?.view ?? null,
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
