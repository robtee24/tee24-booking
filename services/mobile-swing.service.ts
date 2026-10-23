// Video swing analysis: mint upload tickets for swinglab, track jobs, fold the
// resulting feedback into the member's practice plan.
import type { Prisma, SwingAnalysis } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mintUploadTicket, signFileUrl, swinglab, swinglabConfig, TICKET_TTL_S, type SwinglabJob, type SwinglabReport } from "@/lib/swinglab";
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
  return {
    handedness,
    view,
    club: input.club?.trim().slice(0, 40) || null,
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

/** Step 1: create the record and hand the phone an upload ticket. */
export async function createAnalysis(memberId: string, input: CreateSwingInput) {
  requireEnabled();
  const data = cleanInput(input);
  const analysis = await prisma.swingAnalysis.create({ data: { memberId, status: "PENDING", ...data } });
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
    take: Math.min(100, Math.max(1, limit)),
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

function base(a: SwingAnalysis) {
  const report = a.report as SwinglabReport | null;
  return {
    id: a.id,
    status: a.status as "PENDING" | "UPLOADED" | "DONE" | "ERROR" | "EXPIRED",
    handedness: a.handedness,
    view: a.view,
    club: a.club,
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
