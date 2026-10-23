/**
 * Client for the Tee24-League app (github.com/robtee24/tee24-winterleague).
 *
 * The league app is a separate Next.js deployment with its own database. The
 * member app never talks to it directly — these helpers run server-side so
 * the league URL can change without an app release, and so we can match the
 * signed-in member to their league Player record before submitting scores.
 *
 * Env: LEAGUE_API_BASE (e.g. https://league.tee24.golf). Unset = league
 * features report "not configured" instead of failing.
 */

export type LeaguePlayer = { id: number; firstName: string; lastName: string | null; phone: string | null; email: string | null; leagueId: number; winningsEligible?: boolean };
export type LeagueWeek = { id: number; weekNumber: number; leagueId: number; isChampionship: boolean };
export type LeagueCourse = { id: number; name: string; week: number; leagueId: number };
export type LeagueHandicap = { id: number; playerId: number; weekId: number; handicap: number; appliedHandicap: number | null; isBaseline: boolean; week: LeagueWeek };
export type LeagueScore = {
  id: number;
  playerId: number;
  weekId: number;
  front9: number | null;
  back9: number | null;
  total: number | null;
  weightedScore: number | null;
  isDefault: boolean;
  scorecardImage: string | null;
  createdAt: string;
  week: LeagueWeek;
  player: Pick<LeaguePlayer, "id" | "firstName" | "lastName" | "leagueId">;
} & Record<`hole${number}`, number | null>;
export type LeagueTeam = { id: number; teamNumber: number; leagueId: number; player1Id: number; player2Id: number; player1?: LeaguePlayer; player2?: LeaguePlayer };
export type LeagueMatch = { id: number; weekId: number; team1Id: number; team2Id: number | null; team1Points: number; team2Points: number; winnerId: number | null; week?: LeagueWeek; team1?: LeagueTeam; team2?: LeagueTeam | null };
export type LeagueInfo = { id: number; name: string };

export function leagueBase(): string | null {
  const v = (process.env.LEAGUE_API_BASE ?? "").trim().replace(/\/+$/, "");
  return v || null;
}

export function leagueConfigured() {
  return Boolean(leagueBase());
}

async function get<T>(path: string): Promise<T> {
  const base = leagueBase();
  if (!base) throw new Error("League integration is not configured (LEAGUE_API_BASE)");
  const res = await fetch(`${base}${path}`, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`League API ${path} failed (${res.status})`);
  return (await res.json()) as T;
}

export const leagueApi = {
  leagues: () => get<LeagueInfo[]>("/api/leagues"),
  players: (leagueId: number) => get<LeaguePlayer[]>(`/api/players?leagueId=${leagueId}`),
  weeks: (leagueId: number) => get<LeagueWeek[]>(`/api/weeks?leagueId=${leagueId}`),
  courses: (leagueId: number) => get<LeagueCourse[]>(`/api/courses?leagueId=${leagueId}`),
  scores: (q: { leagueId?: number; playerId?: number; weekId?: number }) => {
    const sp = new URLSearchParams();
    if (q.leagueId) sp.set("leagueId", String(q.leagueId));
    if (q.playerId) sp.set("playerId", String(q.playerId));
    if (q.weekId) sp.set("weekId", String(q.weekId));
    return get<LeagueScore[]>(`/api/scores?${sp}`);
  },
  handicaps: (q: { leagueId?: number; playerId?: number }) => {
    const sp = new URLSearchParams();
    if (q.leagueId) sp.set("leagueId", String(q.leagueId));
    if (q.playerId) sp.set("playerId", String(q.playerId));
    return get<LeagueHandicap[]>(`/api/handicaps?${sp}`);
  },
  teams: (leagueId: number) => get<LeagueTeam[]>(`/api/teams?leagueId=${leagueId}`).catch(() => [] as LeagueTeam[]),
  matches: (leagueId: number) => get<LeagueMatch[]>(`/api/matches?leagueId=${leagueId}`).catch(() => [] as LeagueMatch[]),

  async submitScore(input: { playerId: number; weekId: number; scores: number[]; scorecardImage?: string | null }) {
    const base = leagueBase();
    if (!base) throw new Error("League integration is not configured (LEAGUE_API_BASE)");
    const res = await fetch(`${base}/api/scores`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: input.playerId, weekId: input.weekId, scores: input.scores, scorecardImage: input.scorecardImage ?? null }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `Score submission failed (${res.status})`);
    return json as unknown as LeagueScore;
  },

  /** Upload a scorecard photo (JPEG/PNG bytes) → public URL in the league's storage bucket. */
  async uploadScorecard(bytes: Uint8Array, mime: string, fileName: string): Promise<string> {
    const base = leagueBase();
    if (!base) throw new Error("League integration is not configured (LEAGUE_API_BASE)");
    const fd = new FormData();
    fd.append("file", new Blob([bytes as BlobPart], { type: mime }), fileName);
    const res = await fetch(`${base}/api/upload`, { method: "POST", body: fd });
    const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !json.url) throw new Error(json.error ?? `Upload failed (${res.status})`);
    return json.url;
  },
};

/** Match a Tee24 member to a league Player: phone digits first, then exact name. */
export function matchPlayer(players: LeaguePlayer[], member: { firstName: string; lastName: string; phone: string | null; email: string | null }): LeaguePlayer | null {
  const digits = (member.phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length === 10) {
    const byPhone = players.find((p) => (p.phone ?? "").replace(/\D/g, "").slice(-10) === digits);
    if (byPhone) return byPhone;
  }
  const email = member.email?.trim().toLowerCase();
  if (email) {
    const byEmail = players.find((p) => (p.email ?? "").trim().toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  const f = norm(member.firstName);
  const l = norm(member.lastName);
  const byName = players.filter((p) => norm(p.firstName) === f && norm(p.lastName) === l);
  if (byName.length === 1) return byName[0]!;
  // Single-name roster entries ("Rob") — only when unambiguous
  const byFirst = players.filter((p) => norm(p.firstName) === f && !p.lastName);
  if (byName.length === 0 && byFirst.length === 1) return byFirst[0]!;
  return null;
}
