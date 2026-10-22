// lib/kiosk/release.ts
/**
 * Where kiosk builds live. The GitHub Actions workflow
 * (.github/workflows/kiosk-release.yml) publishes a release tagged
 * `kiosk-vX.Y.Z` with the Windows installer + `latest.yml` (electron-updater).
 */
export const KIOSK_REPO = process.env.KIOSK_RELEASE_REPO?.trim() || "robtee24/tee24-booking";
export const KIOSK_TAG_PREFIX = "kiosk-v";

export type KioskRelease = {
  version: string;
  tag: string;
  publishedAt: string | null;
  installerUrl: string | null;
  installerName: string | null;
  installerSize: number | null;
  releaseUrl: string;
};

type GhAsset = { name: string; browser_download_url: string; size: number };
type GhRelease = { tag_name: string; html_url: string; published_at: string | null; draft: boolean; prerelease: boolean; assets: GhAsset[] };

let cache: { at: number; value: KioskRelease | null } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/** Latest published kiosk release (cached 5 min). Null if none exists yet. */
export async function getLatestKioskRelease(): Promise<KioskRelease | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value: KioskRelease | null = null;
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "tee24-booking" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${KIOSK_REPO}/releases?per_page=20`, { headers, next: { revalidate: 300 } });
    if (res.ok) {
      const releases = (await res.json()) as GhRelease[];
      const rel = releases.find((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(KIOSK_TAG_PREFIX));
      if (rel) {
        const exe = rel.assets.find((a) => /\.exe$/i.test(a.name)) ?? null;
        value = {
          version: rel.tag_name.slice(KIOSK_TAG_PREFIX.length),
          tag: rel.tag_name,
          publishedAt: rel.published_at,
          installerUrl: exe?.browser_download_url ?? null,
          installerName: exe?.name ?? null,
          installerSize: exe?.size ?? null,
          releaseUrl: rel.html_url,
        };
      }
    }
  } catch (e) {
    console.error("[kiosk/release] lookup failed:", e instanceof Error ? e.message : e);
  }
  cache = { at: Date.now(), value };
  return value;
}
