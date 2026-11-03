// Vercel Blob storage for swing analysis media.
//
// With the analyzer hosted on Vercel there is no disk that outlives a
// request, so the member's clip, every rendered output and the analyzer's
// job.json live in a Blob store. Layout (shared with swing-analyzer/src/swinglab/api/blob.py):
//
//   jobs/<jobId>/swing.mp4            the clip, PUT straight from the phone via a presigned URL
//   jobs/<jobId>/job.json             analyzer status + report
//   jobs/<jobId>/<output files>       annotated / side-by-side mp4s, stills, …
//   jobs/<jobId>/student_*.{npz,pkl}  pose cache so a pro swap skips tracking
//   pros/<swingId>.jpg, pros/index.json   picker thumbnails + listing
//
// Enabled when BLOB_READ_WRITE_TOKEN is set (the store is connected to this
// project). Public store: reads are plain CDN GETs; writes need the token.
import { del, head, issueSignedToken, list, presignUrl } from "@vercel/blob";

const MEDIA_SUFFIXES = new Set([".mp4", ".mov", ".m4v", ".png", ".jpg", ".jpeg", ".webp"]);
const MEDIA_KEEP = new Set(["job.json", "student_pose.npz", "student_cache.pkl"]);

export function swingBlobConfig() {
  const token = (process.env.BLOB_READ_WRITE_TOKEN ?? "").trim();
  // vercel_blob_rw_<storeId>_<secret>
  const parts = token.split("_");
  const storeId = token && parts.length >= 5 ? parts[3]!.toLowerCase() : "";
  return {
    enabled: Boolean(storeId),
    token,
    publicBase: storeId ? `https://${storeId}.public.blob.vercel-storage.com` : "",
  };
}

export const swingBlobEnabled = () => swingBlobConfig().enabled;

export function blobUrl(pathname: string) {
  return `${swingBlobConfig().publicBase}/${pathname.replace(/^\/+/, "")}`;
}

export const jobPath = (jobId: string, name = "") => (name ? `jobs/${jobId}/${name}` : `jobs/${jobId}/`);

export const SOURCE_CLIP = "swing.mp4";

export type PresignedUpload = {
  url: string;
  method: "PUT";
  /** Sent as-is by the client alongside the file's own Content-Type. */
  headers: Record<string, string>;
  expiresAt: Date;
};

/**
 * One-shot presigned PUT for the member's clip. The phone/browser sends the
 * raw file body; Blob enforces the size and content-type limits server-side.
 */
export async function presignClipUpload(jobId: string, maxBytes: number, ttlS: number): Promise<PresignedUpload> {
  const pathname = jobPath(jobId, SOURCE_CLIP);
  const validUntil = Date.now() + ttlS * 1000;
  const allowedContentTypes = ["video/*", "application/octet-stream"];
  const signed = await issueSignedToken({ pathname, operations: ["put"], validUntil, maximumSizeInBytes: maxBytes, allowedContentTypes });
  const { presignedUrl } = await presignUrl(signed, {
    operation: "put",
    pathname,
    access: "public",
    validUntil,
    allowedContentTypes,
    maximumSizeInBytes: maxBytes,
    allowOverwrite: true,
    addRandomSuffix: false,
  });
  return { url: presignedUrl, method: "PUT", headers: {}, expiresAt: new Date(validUntil) };
}

/** Size of a stored blob, or null when it isn't there. */
export async function blobSize(pathname: string): Promise<number | null> {
  try {
    const h = await head(blobUrl(pathname));
    return h.size;
  } catch {
    return null;
  }
}

/** Analyzer job record straight from the CDN (cache-busted). */
export async function readJobRecord<T>(jobId: string): Promise<T | null> {
  const res = await fetch(`${blobUrl(jobPath(jobId, "job.json"))}?t=${Date.now()}`, { cache: "no-store", headers: { "cache-control": "no-cache" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`blob job.json ${res.status}`);
  return (await res.json()) as T;
}

async function listJob(jobId: string) {
  const out: { url: string; pathname: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: jobPath(jobId), limit: 1000, cursor });
    out.push(...page.blobs.map((b) => ({ url: b.url, pathname: b.pathname })));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** Drop the clip and rendered media; keep job.json and the pose cache so a pro swap can render again. */
export async function purgeJobMedia(jobId: string) {
  const victims = (await listJob(jobId)).filter((b) => {
    const base = b.pathname.split("/").pop() ?? "";
    const ext = base.slice(base.lastIndexOf(".")).toLowerCase();
    return !MEDIA_KEEP.has(base) && MEDIA_SUFFIXES.has(ext);
  });
  if (victims.length) await del(victims.map((b) => b.url));
  return victims.length;
}

const VIDEO_SUFFIXES = new Set([".mp4", ".mov", ".m4v"]);

/**
 * Retention purges. `clip` removes only the member's source clip (a pro swap
 * then needs a re-upload); `videos` removes the clip and every rendered video
 * but keeps stills, the report and the pose cache.
 */
export async function purgeJobFiles(jobId: string, what: "clip" | "videos") {
  const victims = (await listJob(jobId)).filter((b) => {
    const base = b.pathname.split("/").pop() ?? "";
    if (base.startsWith("swing.") && VIDEO_SUFFIXES.has(base.slice(base.lastIndexOf(".")).toLowerCase())) return true;
    if (what === "clip") return false;
    return !MEDIA_KEEP.has(base) && VIDEO_SUFFIXES.has(base.slice(base.lastIndexOf(".")).toLowerCase());
  });
  if (victims.length) await del(victims.map((b) => b.url));
  return victims.length;
}

export async function deleteJob(jobId: string) {
  const all = await listJob(jobId);
  if (all.length) await del(all.map((b) => b.url));
  return all.length;
}
