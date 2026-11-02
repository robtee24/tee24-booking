/** Name normalisation + fuzzy matching between scorecard names and league players. */

export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameTokens(s: string | null | undefined): string[] {
  return normName(s).split(" ").filter(Boolean);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

/**
 * Similarity in [0,1] between two names. Exact normalised match = 1; token
 * overlap and edit distance otherwise (OCR mangles a character or two).
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const compactA = na.replace(/ /g, "");
  const compactB = nb.replace(/ /g, "");
  if (compactA === compactB) return 0.98;
  if (compactA.startsWith(compactB) || compactB.startsWith(compactA)) return 0.9;
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  const overlap = ta.filter((t) => tb.includes(t)).length;
  const tokenScore = overlap / Math.max(ta.length, tb.length);
  const dist = levenshtein(compactA, compactB);
  const editScore = 1 - dist / Math.max(compactA.length, compactB.length);
  return Math.max(tokenScore * 0.95, editScore);
}

/** Best candidate above `threshold`, or null when ambiguous / too weak. */
export function bestNameMatch<T>(target: string, candidates: T[], nameOf: (c: T) => string[], threshold = 0.72): { match: T; score: number } | null {
  let best: { match: T; score: number } | null = null;
  let runnerUp = 0;
  for (const c of candidates) {
    const score = Math.max(0, ...nameOf(c).map((n) => nameSimilarity(target, n)));
    if (!best || score > best.score) {
      runnerUp = best?.score ?? 0;
      best = { match: c, score };
    } else if (score > runnerUp) runnerUp = score;
  }
  if (!best || best.score < threshold) return null;
  // Two near-identical candidates → ambiguous
  if (best.score < 1 && runnerUp >= best.score - 0.05) return null;
  return best;
}
