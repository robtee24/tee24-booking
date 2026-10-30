// Client for the swinglab video analysis service (swing-analyzer/).
//
// Flow: the backend mints a short-lived upload *ticket*; the phone POSTs the
// video straight to swinglab (so the clip never transits Vercel's 4.5 MB body
// limit); the backend then polls /jobs/{id} with the API key and signs asset
// URLs for the phone. HMAC formats must match swinglab/api/server.py.
import { createHmac, timingSafeEqual } from "node:crypto";

export const TICKET_TTL_S = 15 * 60;
export const FILE_URL_TTL_S = 6 * 60 * 60;

const trim = (s: string | undefined | null) => (s ?? "").trim().replace(/\/+$/, "");

export function swinglabConfig() {
  const apiBase = trim(process.env.SWINGLAB_API_BASE);
  const publicBase = trim(process.env.SWINGLAB_PUBLIC_BASE) || apiBase;
  const apiKey = (process.env.SWINGLAB_API_KEY ?? "").trim();
  return { apiBase, publicBase, apiKey, enabled: Boolean(apiBase && apiKey) };
}

function sig(key: string, msg: string) {
  return createHmac("sha256", key).update(msg).digest("hex");
}

/** `<analysisId>.<exp>.<hmac(key, "<analysisId>.<exp>")>` */
export function mintUploadTicket(analysisId: string, ttlS = TICKET_TTL_S) {
  const { apiKey } = swinglabConfig();
  const exp = Math.floor(Date.now() / 1000) + ttlS;
  return { ticket: `${analysisId}.${exp}.${sig(apiKey, `${analysisId}.${exp}`)}`, expiresAt: new Date(exp * 1000) };
}

export function verifyUploadTicket(ticket: string): string | null {
  const { apiKey } = swinglabConfig();
  const parts = ticket.split(".");
  if (parts.length !== 3) return null;
  const [id, expS, s] = parts as [string, string, string];
  const exp = Number(expS);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  const expect = sig(apiKey, `${id}.${exp}`);
  if (expect.length !== s.length || !timingSafeEqual(Buffer.from(expect), Buffer.from(s))) return null;
  return id;
}

/** Signed, phone-fetchable URL for a rendered output (`?exp=&sig=`). */
export function signFileUrl(jobId: string, name: string, ttlS = FILE_URL_TTL_S) {
  const { publicBase, apiKey } = swinglabConfig();
  const exp = Math.floor(Date.now() / 1000) + ttlS;
  const s = sig(apiKey, `${jobId}/${name}.${exp}`);
  const encoded = name.split("/").map(encodeURIComponent).join("/");
  return `${publicBase}/files/${encodeURIComponent(jobId)}/${encoded}?exp=${exp}&sig=${s}`;
}

export type SwinglabJob = {
  job_id: string;
  status: "running" | "done" | "error";
  analysis_id?: string | null;
  created_at?: number;
  seconds?: number;
  error?: string;
  report?: SwinglabReport;
  /** analyzing | rendering | comparing while running */
  stage?: string | null;
  /** Quick-look camera angle (face_on | down_the_line | unknown) */
  detected_view?: string | null;
  detected_view_confidence?: number | null;
  /** Pro queued via /recompare while the job was still running */
  pending_pro_id?: string | null;
};

export type SwinglabReport = {
  format: string;
  version: string;
  source: { fps: number; width: number; height: number; frames: number; duration_s: number; pose_low_confidence_ratio: number };
  view: string;
  handedness: string;
  phases: { source: string; events: { event: string; label: string; p_position: string; frame: number; time_s: number }[] };
  club: { backend: string; detected_ratio: number; interpolated_ratio?: number; missing_ratio?: number; path?: unknown };
  metrics: {
    view: string;
    handedness: string;
    rotation_source?: string;
    reliable_phase_metrics: string[];
    phases: Record<string, unknown>[];
    summary: { name: string; value: number | null; unit: string; reliable: boolean; note: string }[];
  };
  comparison: unknown;
  pro_reference: SwinglabProReference | null;
  feedback: {
    rule: string;
    kind: string;
    phase: string;
    metric: string;
    severity: number; // 1..3
    title: string;
    message: string;
    drill?: string | null;
    value?: number | null;
    threshold?: number | null;
    delta?: number | null;
    z_score?: number | null;
  }[];
  warnings: string[];
  outputs: Record<string, string | Record<string, string>>;
};

async function call<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { apiBase, apiKey } = swinglabConfig();
  if (!apiBase) throw new Error("SWINGLAB_API_BASE not configured");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000);
  try {
    const res = await fetch(`${apiBase}${path}`, { ...init, headers: { ...(init.headers ?? {}), "X-Api-Key": apiKey }, signal: ctrl.signal, cache: "no-store" });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) {
      const detail = (json as { detail?: string } | null)?.detail ?? text.slice(0, 200);
      const err = new Error(`swinglab ${res.status}: ${detail}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return json as T;
  } finally {
    clearTimeout(t);
  }
}

/** Signed URL for a pro-bank thumbnail (`GET /pros/{id}/thumb?exp=&sig=`). */
export function signProThumbUrl(swingId: string, ttlS = FILE_URL_TTL_S) {
  const { publicBase, apiKey } = swinglabConfig();
  const exp = Math.floor(Date.now() / 1000) + ttlS;
  const s = sig(apiKey, `pros/${swingId}/thumb.${exp}`);
  return `${publicBase}/pros/${encodeURIComponent(swingId)}/thumb?exp=${exp}&sig=${s}`;
}

export type SwinglabPro = {
  swing_id: string;
  player: string;
  view: "face_on" | "down_the_line" | string;
  handedness: "right" | "left" | string;
  club: string;
  /** True when the clip will be flipped left<->right to match the requested handedness. */
  mirrored: boolean;
  source_url: string;
  source_title: string;
  fps: number;
  width: number;
  height: number;
  event_frames: number[];
  has_video: boolean;
  has_thumb: boolean;
  thumb: string | null;
  tempo: number;
};

export type SwinglabProReference = {
  swing_id: string;
  player: string;
  club: string;
  view: string;
  handedness: string;
  mirrored: boolean;
  source_url?: string;
  source_title?: string;
};

export const swinglab = {
  health: () => call<{ status: string; version: string; auth: boolean; pro_compare: boolean; pro_reference?: string; pro_bank_size?: number }>("/health"),
  listPros: (params: { view?: string | null; handedness?: string | null } = {}) => {
    const q = new URLSearchParams();
    if (params.view) q.set("view", params.view);
    if (params.handedness) q.set("handedness", params.handedness);
    const qs = q.toString();
    return call<{ pros: SwinglabPro[]; players: string[] }>(`/pros${qs ? `?${qs}` : ""}`);
  },
  getJob: (jobId: string) => call<SwinglabJob>(`/jobs/${encodeURIComponent(jobId)}`),
  recompare: (jobId: string, proId: string) =>
    call<{ job_id: string; status: string; queued?: boolean }>(`/jobs/${encodeURIComponent(jobId)}/recompare`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ pro_id: proId }).toString(),
      timeoutMs: 20_000,
    }),
  deleteJob: (jobId: string) => call<{ ok: boolean }>(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => ({ ok: false })),
  /** Drop rendered videos and the source clip. Pose cache and the report stay so a later pro swap can render again. */
  purgeMedia: (jobId: string) => call<{ ok: boolean }>(`/jobs/${encodeURIComponent(jobId)}/media`, { method: "DELETE" }).catch(() => ({ ok: false })),
};
