/**
 * Tee24 League (v2).
 *
 * Three leagues run off one weekly score: individual straight (gross),
 * individual handicapped (net) and 2-player weekly teams (best-ball match
 * play). One points leaderboard. $10/week entry charged to the member's card
 * on file at submission (minors play free, flagged, not eligible for money).
 * Scores stay hidden until the Sunday 11:59 PM deadline; the deadline job then
 * reveals the week, computes handicaps / ranks / points / matches / payouts,
 * and draws next week's teams.
 */
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminNotify } from "@/lib/admin-notify";
import { createInvoice, chargeInvoiceWithDefaultCard, writeOffInvoice } from "@/services/billing.service";
import { findMemberByPhone } from "@/services/mobile-auth.service";
import { handicapForWeek, strokesBack, weekLows, type HandicapSettings } from "@/lib/league/handicap";
import { pointsForRank, rankByScore, type PointsSettings } from "@/lib/league/points";
import { weeklyPayouts, type PayoutKind } from "@/lib/league/payouts";
import { bestBall, drawTeams, pairKey, playMatch, type HoleCard } from "@/lib/league/teams";
import { ageAt, buildWeeks, fmtDeadline } from "@/lib/league/schedule";
import { bestNameMatch, normName } from "@/lib/league/names";
import { checkSettings, parseScorecard, type OcrLine, type ParsedPlayerRow } from "@/lib/league/ocr";

export class LeagueError extends Error {
  constructor(message: string, public status = 400, public code = "BAD_REQUEST", public extra?: Record<string, unknown>) {
    super(message);
    this.name = "LeagueError";
  }
}

const HOLE_MIN = 1;
const HOLE_MAX = 15;

/* ───────────────────────────── helpers ───────────────────────────── */

function cleanHoles(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== 18) throw new LeagueError("Enter all 18 holes", 400, "HOLES_REQUIRED");
  const holes = raw.map((h) => Math.round(Number(h)));
  if (holes.some((h) => !Number.isFinite(h) || h < HOLE_MIN || h > HOLE_MAX)) throw new LeagueError(`Each hole must be between ${HOLE_MIN} and ${HOLE_MAX} strokes`, 400, "HOLES_INVALID");
  return holes;
}

function sum(a: number[]) {
  return a.reduce((s, v) => s + v, 0);
}

export function playerName(p: { displayName: string | null; member: { firstName: string; lastName: string } }): string {
  return p.displayName?.trim() || `${p.member.firstName} ${p.member.lastName}`.trim();
}

type LeagueRow = Prisma.LeagueGetPayload<{ include: { location: { select: { id: true; name: true; slug: true; timezone: true; organizationId: true } } } }>;

async function loadLeague(leagueId: string): Promise<LeagueRow> {
  const league = await getPrisma().league.findUnique({ where: { id: leagueId }, include: { location: { select: { id: true, name: true, slug: true, timezone: true, organizationId: true } } } });
  if (!league) throw new LeagueError("League not found", 404, "LEAGUE_NOT_FOUND");
  return league;
}

/**
 * The league is organization-wide: one league shared by every Tee24 location.
 * `League.locationId` is only the "home" location used for the time zone and
 * invoice bookkeeping. These helpers decide whether a kiosk / admin at a given
 * location can see a league.
 */
export async function leagueScopeForLocations(locationIds: string[]): Promise<Prisma.LeagueWhereInput> {
  if (locationIds.length === 0) return { id: "__none__" };
  const locs = await getPrisma().location.findMany({ where: { id: { in: locationIds } }, select: { organizationId: true } });
  const orgIds = Array.from(new Set(locs.map((l) => l.organizationId).filter((x): x is string => !!x)));
  return { OR: [{ locationId: { in: locationIds } }, ...(orgIds.length ? [{ organizationId: { in: orgIds } }] : [])] };
}

async function assertLeagueVisibleAt(league: { id: string; locationId: string; organizationId: string | null }, locationId: string) {
  if (league.locationId === locationId) return;
  const loc = await getPrisma().location.findUnique({ where: { id: locationId }, select: { organizationId: true } });
  if (loc?.organizationId && loc.organizationId === league.organizationId) return;
  throw new LeagueError("This league isn't available at this location", 403, "WRONG_LOCATION");
}

function hcSettings(l: { handicapCap: number; throwOutEvery: number; openingWeeks: number }): HandicapSettings {
  return { handicapCap: l.handicapCap, throwOutEvery: l.throwOutEvery, openingWeeks: l.openingWeeks };
}

function ptSettings(l: { pointsTop5: number; pointsTop10: number; pointsTop15: number; pointsTeamWin: number; pointsTeamTie: number }): PointsSettings {
  return { pointsTop5: l.pointsTop5, pointsTop10: l.pointsTop10, pointsTop15: l.pointsTop15, pointsTeamWin: l.pointsTeamWin, pointsTeamTie: l.pointsTeamTie };
}

/** The week that is open for submissions right now (or the next one to open). */
export function currentWeekOf<T extends { opensAt: Date; deadlineAt: Date; weekNumber: number }>(weeks: T[], now = new Date()): T | null {
  const sorted = [...weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  return sorted.find((w) => w.opensAt <= now && w.deadlineAt >= now) ?? sorted.find((w) => w.opensAt > now) ?? null;
}

export function isMinorFor(dob: Date | null | undefined, minorAge: number, at = new Date()): boolean {
  return !!dob && ageAt(dob, at) < minorAge;
}

/* ───────────────────────────── admin: leagues ───────────────────────────── */

export type CreateLeagueInput = {
  locationId: string;
  name: string;
  description?: string | null;
  firstWeekStart: Date;
  weekCount: number;
  withChampionshipWeek?: boolean;
  courses?: (string | null)[];
  championshipAt?: Date | null;
  championshipNote?: string | null;
  weeklyFeeCents?: number;
  gimmeDistanceFt?: number;
  mulligans?: boolean;
  greenSpeed?: string;
  teeRules?: { label: string; maxAge: number | null; tee: string }[] | null;
  rulesUrl?: string | null;
};

export async function createLeague(input: CreateLeagueInput, actorId?: string) {
  const prisma = getPrisma();
  const loc = await prisma.location.findUnique({ where: { id: input.locationId }, select: { id: true, timezone: true, organizationId: true } });
  if (!loc) throw new LeagueError("Location not found", 404, "LOCATION_NOT_FOUND");
  if (!input.name.trim()) throw new LeagueError("Name is required");
  if (!Number.isInteger(input.weekCount) || input.weekCount < 1 || input.weekCount > 30) throw new LeagueError("Week count must be 1–30");
  const running = await prisma.league.findFirst({
    where: { status: { in: ["OPEN", "ACTIVE"] }, ...(await leagueScopeForLocations([loc.id])) },
    select: { id: true, name: true },
  });
  if (running) throw new LeagueError(`"${running.name}" is already running. There is one league for all Tee24 locations — complete it before starting another.`, 409, "LEAGUE_ALREADY_RUNNING");
  const weeks = buildWeeks(input.firstWeekStart, input.weekCount, loc.timezone, !!input.withChampionshipWeek);
  const league = await prisma.league.create({
    data: {
      organizationId: loc.organizationId,
      locationId: loc.id,
      name: input.name.trim().slice(0, 120),
      description: input.description?.trim() || null,
      status: "OPEN",
      championshipAt: input.championshipAt ?? null,
      championshipNote: input.championshipNote?.trim() || null,
      weeklyFeeCents: input.weeklyFeeCents ?? 1000,
      gimmeDistanceFt: input.gimmeDistanceFt ?? 10,
      mulligans: input.mulligans ?? false,
      greenSpeed: input.greenSpeed?.trim() || "Normal",
      teeRules: input.teeRules === undefined ? defaultTeeRules() : (input.teeRules as Prisma.InputJsonValue | null) ?? undefined,
      rulesUrl: input.rulesUrl?.trim() || null,
      weeks: { create: weeks.map((w, i) => ({ weekNumber: w.weekNumber, opensAt: w.opensAt, deadlineAt: w.deadlineAt, isChampionship: w.isChampionship, courseName: input.courses?.[i]?.trim() || null })) },
    },
    include: { weeks: { orderBy: { weekNumber: "asc" } } },
  });
  void audit({ organizationId: loc.organizationId, actorId, action: "league.create", entityType: "League", entityId: league.id, after: league });
  return league;
}

export function defaultTeeRules() {
  return [
    { label: "Under 50", maxAge: 49, tee: "Blue" },
    { label: "50–64", maxAge: 64, tee: "White" },
    { label: "65 and over", maxAge: null, tee: "Gold" },
  ] as Prisma.InputJsonValue;
}

export type UpdateLeagueInput = Partial<Pick<CreateLeagueInput, "name" | "description" | "championshipAt" | "championshipNote" | "weeklyFeeCents" | "gimmeDistanceFt" | "mulligans" | "greenSpeed" | "teeRules" | "rulesUrl">> &
  Partial<{ status: "DRAFT" | "OPEN" | "ACTIVE" | "COMPLETE"; minorAge: number; firstPlacePct: number; firstPlaceCapCents: number; secondPlacePct: number; secondPlaceCapCents: number; openingWeeks: number; handicapCap: number; throwOutEvery: number; pointsTop5: number; pointsTop10: number; pointsTop15: number; pointsTeamWin: number; pointsTeamTie: number; championshipTopPct: number }>;

export async function updateLeague(leagueId: string, patch: UpdateLeagueInput, actorId?: string) {
  const prisma = getPrisma();
  const before = await loadLeague(leagueId);
  const data: Prisma.LeagueUpdateInput = {};
  const num = (k: keyof UpdateLeagueInput, min: number, max: number) => {
    const v = patch[k];
    if (v === undefined) return;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new LeagueError(`${k} must be between ${min} and ${max}`);
    (data as Record<string, unknown>)[k] = Math.round(n);
  };
  if (patch.name !== undefined) data.name = String(patch.name).trim().slice(0, 120) || before.name;
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.championshipAt !== undefined) data.championshipAt = patch.championshipAt;
  if (patch.championshipNote !== undefined) data.championshipNote = patch.championshipNote?.trim() || null;
  if (patch.mulligans !== undefined) data.mulligans = !!patch.mulligans;
  if (patch.greenSpeed !== undefined) data.greenSpeed = String(patch.greenSpeed).trim() || "Normal";
  if (patch.teeRules !== undefined) data.teeRules = (patch.teeRules as Prisma.InputJsonValue | null) ?? undefined;
  if (patch.rulesUrl !== undefined) data.rulesUrl = patch.rulesUrl?.trim() || null;
  num("weeklyFeeCents", 0, 100000);
  num("minorAge", 0, 25);
  num("firstPlacePct", 0, 100);
  num("firstPlaceCapCents", 0, 1000000);
  num("secondPlacePct", 0, 100);
  num("secondPlaceCapCents", 0, 1000000);
  num("openingWeeks", 0, 10);
  num("handicapCap", 0, 54);
  num("throwOutEvery", 0, 20);
  num("pointsTop5", 0, 50);
  num("pointsTop10", 0, 50);
  num("pointsTop15", 0, 50);
  num("pointsTeamWin", 0, 50);
  num("pointsTeamTie", 0, 50);
  num("championshipTopPct", 1, 100);
  num("gimmeDistanceFt", 0, 60);
  const after = await prisma.league.update({ where: { id: leagueId }, data });
  void audit({ organizationId: before.organizationId, actorId, action: "league.update", entityType: "League", entityId: leagueId, before, after });
  return after;
}

export async function updateWeek(weekId: string, patch: { courseName?: string | null; opensAt?: Date; deadlineAt?: Date; isChampionship?: boolean }, actorId?: string) {
  const prisma = getPrisma();
  const week = await prisma.leagueWeek.findUnique({ where: { id: weekId }, include: { league: { select: { organizationId: true } } } });
  if (!week) throw new LeagueError("Week not found", 404, "WEEK_NOT_FOUND");
  if (week.finalizedAt && (patch.deadlineAt || patch.opensAt)) throw new LeagueError("This week is already finalized", 409, "WEEK_FINALIZED");
  const data: Prisma.LeagueWeekUpdateInput = {};
  if (patch.courseName !== undefined) data.courseName = patch.courseName?.trim() || null;
  if (patch.opensAt) data.opensAt = patch.opensAt;
  if (patch.deadlineAt) data.deadlineAt = patch.deadlineAt;
  if (patch.isChampionship !== undefined) data.isChampionship = patch.isChampionship;
  const after = await prisma.leagueWeek.update({ where: { id: weekId }, data });
  void audit({ organizationId: week.league.organizationId, actorId, action: "league.week-update", entityType: "LeagueWeek", entityId: weekId, before: week, after });
  return after;
}

export async function listLeagues(locationIds?: string[] | null) {
  const prisma = getPrisma();
  const rows = await prisma.league.findMany({
    where: locationIds ? await leagueScopeForLocations(locationIds) : {},
    include: {
      location: { select: { id: true, name: true, slug: true, timezone: true } },
      weeks: { orderBy: { weekNumber: "asc" }, select: { id: true, weekNumber: true, courseName: true, opensAt: true, deadlineAt: true, finalizedAt: true, revealedAt: true, potCents: true, isChampionship: true } },
      _count: { select: { players: { where: { active: true } } } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const now = new Date();
  return rows.map((l) => ({ ...l, currentWeek: currentWeekOf(l.weeks, now), playerCount: l._count.players }));
}

/* ───────────────────────────── players ───────────────────────────── */

async function memberForLeague(memberId: string) {
  const m = await getPrisma().member.findUnique({ where: { id: memberId }, select: { id: true, firstName: true, lastName: true, phone: true, email: true, dob: true, locationId: true, organizationId: true, status: true, mergedIntoId: true } });
  if (!m || m.mergedIntoId) throw new LeagueError("Member not found", 404, "MEMBER_NOT_FOUND");
  return m;
}

export async function joinLeague(input: { leagueId: string; memberId: string; displayName?: string | null; via: "APP" | "KIOSK" | "ADMIN"; actorId?: string }) {
  const prisma = getPrisma();
  const league = await loadLeague(input.leagueId);
  if (league.status === "COMPLETE" || league.status === "DRAFT") throw new LeagueError("This league isn't open for new players", 409, "LEAGUE_CLOSED");
  const member = await memberForLeague(input.memberId);
  const existing = await prisma.leaguePlayer.findUnique({ where: { leagueId_memberId: { leagueId: league.id, memberId: member.id } } });
  const isMinor = isMinorFor(member.dob, league.minorAge);
  const displayName = input.displayName?.trim().slice(0, 80) || null;
  if (existing) {
    if (existing.active && !displayName) return { player: existing, created: false };
    const player = await prisma.leaguePlayer.update({ where: { id: existing.id }, data: { active: true, ...(displayName ? { displayName } : {}) } });
    return { player, created: false };
  }
  const player = await prisma.leaguePlayer.create({
    data: { leagueId: league.id, memberId: member.id, displayName, isMinor, winningsEligible: !isMinor, joinedVia: input.via },
  });
  void audit({ organizationId: league.organizationId, actorId: input.actorId, action: "league.join", entityType: "LeaguePlayer", entityId: player.id, after: player, metadata: { via: input.via } });
  return { player, created: true };
}

export async function updatePlayer(playerId: string, patch: { displayName?: string | null; aliases?: string[] | null; winningsEligible?: boolean; isMinor?: boolean; active?: boolean; notes?: string | null }, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.leaguePlayer.findUnique({ where: { id: playerId }, include: { league: { select: { organizationId: true } } } });
  if (!before) throw new LeagueError("Player not found", 404, "PLAYER_NOT_FOUND");
  const data: Prisma.LeaguePlayerUpdateInput = {};
  if (patch.displayName !== undefined) data.displayName = patch.displayName?.trim().slice(0, 80) || null;
  if (patch.aliases !== undefined) data.aliases = patch.aliases ? (patch.aliases.map((a) => String(a).trim()).filter(Boolean) as Prisma.InputJsonValue) : undefined;
  if (patch.winningsEligible !== undefined) data.winningsEligible = !!patch.winningsEligible;
  if (patch.isMinor !== undefined) data.isMinor = !!patch.isMinor;
  if (patch.active !== undefined) data.active = !!patch.active;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;
  const after = await prisma.leaguePlayer.update({ where: { id: playerId }, data });
  void audit({ organizationId: before.league.organizationId, actorId, action: "league.player-update", entityType: "LeaguePlayer", entityId: playerId, before, after });
  return after;
}

/* ───────────────────────────── entries (money) ───────────────────────────── */

/** Does the member have a chargeable card on file? */
async function defaultCard(memberId: string) {
  return getPrisma().paymentMethod.findFirst({
    where: { memberId, status: { not: "EXPIRED" }, squareCardId: { not: null } },
    select: { id: true, last4: true, brand: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

export const ADD_CARD_HINT = "Add a card in the Tee24 app (Settings → Membership → Payment method), then resubmit before Sunday 11:59 PM.";

/**
 * Charge the weekly entry. This runs BEFORE a score is saved: a submission
 * only counts once the fee is paid. Minors (or fee = 0) are WAIVED. No card
 * on file or a declined card throws PAYMENT_REQUIRED and nothing is saved —
 * there is no cash option; the player adds a card in the app and resubmits.
 */
export async function chargeEntry(input: { league: LeagueRow; week: { id: string; weekNumber: number }; player: { id: string; memberId: string; isMinor: boolean }; source: "APP" | "KIOSK" | "ADMIN"; actorId?: string }) {
  const prisma = getPrisma();
  const existing = await prisma.leagueEntry.findUnique({ where: { weekId_playerId: { weekId: input.week.id, playerId: input.player.id } } });
  if (existing && (existing.status === "PAID" || existing.status === "WAIVED")) return existing;

  const fee = input.league.weeklyFeeCents;
  if (input.player.isMinor || fee <= 0) {
    return prisma.leagueEntry.upsert({
      where: { weekId_playerId: { weekId: input.week.id, playerId: input.player.id } },
      create: { leagueId: input.league.id, weekId: input.week.id, playerId: input.player.id, feeCents: 0, status: "WAIVED", source: input.source, paidAt: new Date() },
      update: { status: "WAIVED", feeCents: 0, paidAt: new Date() },
    });
  }

  const card = await defaultCard(input.player.memberId);
  if (!card) {
    await prisma.leagueEntry.upsert({
      where: { weekId_playerId: { weekId: input.week.id, playerId: input.player.id } },
      create: { leagueId: input.league.id, weekId: input.week.id, playerId: input.player.id, feeCents: fee, status: "FAILED", source: input.source, failureReason: "No card on file" },
      update: { status: "FAILED", feeCents: fee, failureReason: "No card on file" },
    });
    throw new LeagueError(`No card on file for the $${(fee / 100).toFixed(0)} weekly entry. ${ADD_CARD_HINT}`, 402, "PAYMENT_REQUIRED", { reason: "NO_CARD" });
  }

  const inv = await createInvoice(
    {
      organizationId: input.league.organizationId,
      locationId: input.league.locationId,
      memberId: input.player.memberId,
      description: `${input.league.name} — Week ${input.week.weekNumber} entry`,
      dueDate: new Date(),
      lines: [{ description: `League entry · Week ${input.week.weekNumber}`, unitCents: fee }],
      adminNotes: `League entry (${input.source.toLowerCase()})`,
    },
    input.actorId,
  );
  const pending = await prisma.leagueEntry.upsert({
    where: { weekId_playerId: { weekId: input.week.id, playerId: input.player.id } },
    create: { leagueId: input.league.id, weekId: input.week.id, playerId: input.player.id, feeCents: fee, status: "PENDING", source: input.source, invoiceId: inv.id },
    update: { status: "PENDING", feeCents: fee, invoiceId: inv.id, failureReason: null },
  });
  try {
    const charge = await chargeInvoiceWithDefaultCard(inv.id, input.actorId);
    const entry = await prisma.leagueEntry.update({ where: { id: pending.id }, data: { status: "PAID", chargeId: charge.id, paidAt: new Date(), failureReason: null } });
    await refreshPot(input.week.id);
    return entry;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Don't leave an open invoice on the member's account for a submission that didn't count.
    await writeOffInvoice(inv.id, { reason: "League entry declined — submission not saved", actorId: input.actorId }).catch(() => {});
    await prisma.leagueEntry.update({ where: { id: pending.id }, data: { status: "FAILED", failureReason: reason.slice(0, 500) } });
    void adminNotify({
      organizationId: input.league.organizationId,
      locationId: input.league.locationId,
      kind: "league.entry-unpaid",
      severity: "WARN",
      title: `League entry declined — ${input.league.name} week ${input.week.weekNumber}`,
      body: reason.slice(0, 300),
      link: `/admin/league/${input.league.id}?week=${input.week.id}`,
      data: { entryId: pending.id, invoiceId: inv.id },
    });
    throw new LeagueError(`Your card ending ${card.last4 ?? "····"} was declined for the $${(fee / 100).toFixed(0)} weekly entry. ${ADD_CARD_HINT}`, 402, "PAYMENT_REQUIRED", { reason: "DECLINED", detail: reason.slice(0, 200) });
  }
}

async function refreshPot(weekId: string) {
  const prisma = getPrisma();
  const agg = await prisma.leagueEntry.aggregate({ where: { weekId, status: "PAID" }, _sum: { feeCents: true } });
  await prisma.leagueWeek.update({ where: { id: weekId }, data: { potCents: agg._sum.feeCents ?? 0 } });
}

/** Admin: waive an entry (comp). */
export async function waiveEntry(entryId: string, actorId: string) {
  const prisma = getPrisma();
  const entry = await prisma.leagueEntry.findUnique({ where: { id: entryId }, include: { league: { select: { organizationId: true } } } });
  if (!entry) throw new LeagueError("Entry not found", 404, "ENTRY_NOT_FOUND");
  const updated = await prisma.leagueEntry.update({ where: { id: entryId }, data: { status: "WAIVED", feeCents: 0, paidAt: new Date(), failureReason: null } });
  void audit({ organizationId: entry.league.organizationId, actorId, action: "league.entry-waive", entityType: "LeagueEntry", entityId: entryId, before: entry, after: updated });
  await refreshPot(entry.weekId);
  return updated;
}

/* ───────────────────────────── scores ───────────────────────────── */

type SubmitCore = {
  league: LeagueRow;
  week: { id: string; weekNumber: number; opensAt: Date; deadlineAt: Date; finalizedAt: Date | null };
  player: { id: string; memberId: string; isMinor: boolean };
  holes: number[];
  source: "APP" | "KIOSK" | "ADMIN";
  submittedByMemberId?: string | null;
  image?: { mimeType: string; buffer: Buffer } | null;
  ocrText?: string[] | null;
  ocrSettings?: Record<string, unknown> | null;
  par?: number[] | null;
  actorId?: string;
  /** Admin override: accept after the deadline */
  allowLate?: boolean;
};

function assertWeekOpen(week: SubmitCore["week"], allowLate = false, now = new Date()) {
  if (week.finalizedAt) throw new LeagueError("This week is finalized", 409, "WEEK_FINALIZED");
  if (now < week.opensAt) throw new LeagueError(`Week ${week.weekNumber} opens ${week.opensAt.toLocaleDateString()}`, 409, "WEEK_NOT_OPEN");
  if (now > week.deadlineAt && !allowLate) throw new LeagueError(`The deadline for week ${week.weekNumber} has passed. There are no make-up rounds.`, 409, "WEEK_CLOSED");
}

function assertNotSubmitted(existing: { status: string } | null, weekNumber: number, source: SubmitCore["source"]) {
  if (existing && existing.status !== "REJECTED" && source !== "ADMIN") {
    throw new LeagueError(`A week ${weekNumber} score has already been submitted for this player. There are no re-dos; ask staff if it needs to be corrected.`, 409, "ALREADY_SUBMITTED");
  }
}

/**
 * Save a score. Order matters: the week must be open, the player must not
 * have a score yet, the entry fee must be paid (card charged / waived), and
 * only then is the score written. Admin entries bypass the charge failure
 * (the entry is recorded FAILED and staff sort it out).
 */
async function saveScore(core: SubmitCore) {
  const prisma = getPrisma();
  assertWeekOpen(core.week, core.allowLate);
  const existing = await prisma.leagueScore.findUnique({ where: { weekId_playerId: { weekId: core.week.id, playerId: core.player.id } } });
  assertNotSubmitted(existing, core.week.weekNumber, core.source);

  let entry;
  try {
    entry = await chargeEntry({ league: core.league, week: core.week, player: core.player, source: core.source, actorId: core.actorId });
  } catch (err) {
    if (core.source !== "ADMIN") throw err;
    entry = (await prisma.leagueEntry.findUnique({ where: { weekId_playerId: { weekId: core.week.id, playerId: core.player.id } } }))!;
  }

  const front9 = sum(core.holes.slice(0, 9));
  const back9 = sum(core.holes.slice(9));
  let imageId: string | null = existing?.imageId ?? null;
  if (core.image) {
    const b = core.image.buffer;
    const data = new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    const img = await prisma.leagueScorecardImage.create({ data: { mimeType: core.image.mimeType, sizeBytes: b.length, data } });
    imageId = img.id;
  }
  const data = {
    holes: core.holes as Prisma.InputJsonValue,
    front9,
    back9,
    gross: front9 + back9,
    handicap: null as number | null,
    net: null as number | null,
    status: core.source === "ADMIN" ? "ACCEPTED" : "SUBMITTED",
    source: core.source,
    rejectReason: null as string | null,
    imageId,
    ocrText: core.ocrText ? (core.ocrText as Prisma.InputJsonValue) : undefined,
    ocrSettings: core.ocrSettings ? (core.ocrSettings as Prisma.InputJsonValue) : undefined,
    par: core.par && core.par.length === 18 ? (core.par as Prisma.InputJsonValue) : undefined,
    submittedByMemberId: core.submittedByMemberId ?? null,
    submittedAt: new Date(),
  };
  const score = existing
    ? await prisma.leagueScore.update({ where: { id: existing.id }, data })
    : await prisma.leagueScore.create({ data: { leagueId: core.league.id, weekId: core.week.id, playerId: core.player.id, ...data } });
  void audit({ organizationId: core.league.organizationId, actorId: core.actorId, action: "league.score-submit", entityType: "LeagueScore", entityId: score.id, after: score, metadata: { source: core.source, entry: entry.status } });
  return { score, entry };
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m) {
    // bare base64 → assume jpeg
    const buf = Buffer.from(dataUrl.replace(/\s+/g, ""), "base64");
    if (!buf.length) throw new LeagueError("Image is empty", 400, "IMAGE_INVALID");
    if (buf.length > 10 * 1024 * 1024) throw new LeagueError("Image too large (10 MB max)", 413, "IMAGE_TOO_LARGE");
    return { mimeType: "image/jpeg", buffer: buf };
  }
  const buffer = Buffer.from(m[2]!.replace(/\s+/g, ""), "base64");
  if (!buffer.length) throw new LeagueError("Image is empty", 400, "IMAGE_INVALID");
  if (buffer.length > 10 * 1024 * 1024) throw new LeagueError("Image too large (10 MB max)", 413, "IMAGE_TOO_LARGE");
  return { mimeType: m[1]!.toLowerCase(), buffer };
}

/** Admin: enter / overwrite a score. */
export async function adminSetScore(input: { leagueId: string; weekId: string; playerId: string; holes: unknown; allowLate?: boolean; actorId: string }) {
  const prisma = getPrisma();
  const league = await loadLeague(input.leagueId);
  const [week, player] = await Promise.all([prisma.leagueWeek.findFirst({ where: { id: input.weekId, leagueId: league.id } }), prisma.leaguePlayer.findFirst({ where: { id: input.playerId, leagueId: league.id } })]);
  if (!week) throw new LeagueError("Week not found", 404, "WEEK_NOT_FOUND");
  if (!player) throw new LeagueError("Player not found", 404, "PLAYER_NOT_FOUND");
  const holes = cleanHoles(input.holes);
  return saveScore({ league, week, player, holes, source: "ADMIN", actorId: input.actorId, allowLate: input.allowLate ?? true });
}

export async function reviewScore(scoreId: string, input: { status: "ACCEPTED" | "REJECTED"; rejectReason?: string | null; holes?: unknown }, actorId: string) {
  const prisma = getPrisma();
  const before = await prisma.leagueScore.findUnique({ where: { id: scoreId }, include: { league: { select: { organizationId: true } }, week: { select: { finalizedAt: true } } } });
  if (!before) throw new LeagueError("Score not found", 404, "SCORE_NOT_FOUND");
  const data: Prisma.LeagueScoreUpdateInput = { status: input.status, rejectReason: input.status === "REJECTED" ? input.rejectReason?.trim().slice(0, 300) || "Rejected by league manager" : null };
  if (input.holes !== undefined) {
    const holes = cleanHoles(input.holes);
    data.holes = holes as Prisma.InputJsonValue;
    data.front9 = sum(holes.slice(0, 9));
    data.back9 = sum(holes.slice(9));
    data.gross = sum(holes);
  }
  const after = await prisma.leagueScore.update({ where: { id: scoreId }, data });
  void audit({ organizationId: before.league.organizationId, actorId, action: "league.score-review", entityType: "LeagueScore", entityId: scoreId, before, after });
  // Re-run the week if it was already finalized so standings reflect the edit.
  if (before.week.finalizedAt) await computeWeek(before.weekId, { recompute: true });
  return after;
}

export async function getScorecardImage(imageId: string) {
  return getPrisma().leagueScorecardImage.findUnique({ where: { id: imageId } });
}

/* ───────────────────────────── kiosk ───────────────────────────── */

/** Public rules page for a league (used by the kiosk QR / link and the app). */
export function leagueRulesUrl(league: { id: string; rulesUrl: string | null }) {
  if (league.rulesUrl) return league.rulesUrl;
  const base = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://reservations.tee24.golf").replace(/\/$/, "");
  return `${base}/league/${league.id}/rules`;
}

/** Step-by-step kiosk tutorial, rendered on the kiosk and in the app. */
export function kioskTutorialSteps(league: { gimmeDistanceFt: number; mulligans: boolean; greenSpeed: string; weeklyFeeCents: number }) {
  return [
    { title: "Set up the round", body: `Before you tee off, set Gimmes to ${league.gimmeDistanceFt} ft, Mulligans ${league.mulligans ? "ON" : "OFF"} and Greens to ${league.greenSpeed}. Open League Settings on this screen to double-check. A card showing mulligans on is rejected.` },
    { title: "Play all 18 on this week's course", body: "Everyone on the bay can play in the same round. Each player's name on the GSPro scorecard is what we match to your membership." },
    { title: "Finish and open the scorecard", body: "After the 18th hole leave the GSPro scorecard on screen. Don't start a new round yet." },
    { title: "Tap League → Submit score", body: "Enter your phone number and the name exactly as it shows on the scorecard. Add up to 5 players from the same card." },
    { title: "Confirm", body: `Each player is charged $${(league.weeklyFeeCents / 100).toFixed(0)} to the card on file (under 18 play free). 100% of the money collected is paid out — weekly prizes plus the season championship pot.` },
    { title: "We read the card", body: "The kiosk takes a screenshot of GSPro, reads every score and settings line, and saves one score per player. You'll see each player's gross so you can confirm it read correctly." },
    { title: "Scores reveal Sunday 11:59 PM", body: "Until then everyone shows as Submitted. Teams for next week are drawn right after the reveal. No make-up rounds — the deadline is hard." },
  ];
}

/** League(s) the kiosk can see (organization-wide) with the week that is open right now. */
export async function kioskLeagueInfo(locationId: string, now = new Date()) {
  const prisma = getPrisma();
  const leagues = await prisma.league.findMany({
    where: { status: { in: ["OPEN", "ACTIVE"] }, ...(await leagueScopeForLocations([locationId])) },
    include: { location: { select: { timezone: true, name: true } }, weeks: { orderBy: { weekNumber: "asc" }, include: { _count: { select: { scores: { where: { status: { not: "REJECTED" } } } } } } }, _count: { select: { players: { where: { active: true } } } } },
  });
  return leagues.map((l) => {
    const week = currentWeekOf(l.weeks, now);
    return {
      id: l.id,
      name: l.name,
      locationName: l.location.name,
      timezone: l.location.timezone,
      weeklyFeeCents: l.weeklyFeeCents,
      playerCount: l._count.players,
      settings: { gimmeDistanceFt: l.gimmeDistanceFt, mulligans: l.mulligans, greenSpeed: l.greenSpeed, teeRules: l.teeRules, minorAge: l.minorAge, openingWeeks: l.openingWeeks, handicapCap: l.handicapCap, throwOutEvery: l.throwOutEvery, pointsTop5: l.pointsTop5, pointsTop10: l.pointsTop10, pointsTop15: l.pointsTop15, pointsTeamWin: l.pointsTeamWin, pointsTeamTie: l.pointsTeamTie, firstPlacePct: l.firstPlacePct, firstPlaceCapCents: l.firstPlaceCapCents, secondPlacePct: l.secondPlacePct, secondPlaceCapCents: l.secondPlaceCapCents, championshipTopPct: l.championshipTopPct },
      rulesUrl: leagueRulesUrl(l),
      tutorialSteps: kioskTutorialSteps(l),
      championshipAt: l.championshipAt?.toISOString() ?? null,
      championshipPotCents: l.championshipPotCents,
      week: week
        ? {
            id: week.id,
            weekNumber: week.weekNumber,
            courseName: week.courseName,
            opensAt: week.opensAt.toISOString(),
            deadlineAt: week.deadlineAt.toISOString(),
            deadlineLabel: fmtDeadline(week.deadlineAt, l.location.timezone),
            isOpen: week.opensAt <= now && week.deadlineAt >= now,
            potCents: week.potCents,
            submittedCount: week._count.scores,
          }
        : null,
    };
  });
}

/** Look a member up by phone for the kiosk flows. */
export async function kioskLookup(leagueId: string, phoneDigits: string, weekId?: string | null) {
  const prisma = getPrisma();
  const digits = phoneDigits.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) throw new LeagueError("Enter a 10-digit phone number.", 400, "PHONE_INVALID");
  const member = await findMemberByPhone(`+1${digits}`);
  if (!member) throw new LeagueError("We couldn't find a Tee24 member with that number. Members can join at the front desk or in the Tee24 app.", 404, "MEMBER_NOT_FOUND");
  const league = await loadLeague(leagueId);
  const [player, full, weeks] = await Promise.all([
    prisma.leaguePlayer.findUnique({ where: { leagueId_memberId: { leagueId, memberId: member.id } } }),
    prisma.member.findUnique({ where: { id: member.id }, select: { dob: true } }),
    prisma.leagueWeek.findMany({ where: { leagueId }, select: { id: true, weekNumber: true, opensAt: true, deadlineAt: true } }),
  ]);
  const card = await defaultCard(member.id);
  const isMinor = player?.isMinor ?? isMinorFor(full?.dob, league.minorAge);
  const week = weekId ? weeks.find((w) => w.id === weekId) ?? null : currentWeekOf(weeks);
  const existing = player && week ? await prisma.leagueScore.findUnique({ where: { weekId_playerId: { weekId: week.id, playerId: player.id } }, select: { status: true } }) : null;
  return {
    member: { id: member.id, firstName: member.firstName, lastName: member.lastName, lastInitial: member.lastName.slice(0, 1) },
    inLeague: !!player?.active,
    player: player ? { id: player.id, displayName: player.displayName, isMinor: player.isMinor, winningsEligible: player.winningsEligible } : null,
    isMinor,
    hasCard: !!card,
    card: card ? { last4: card.last4, brand: card.brand } : null,
    feeCents: isMinor ? 0 : league.weeklyFeeCents,
    /** Can this player pay (or is waived) for the weekly entry right now? */
    canPay: isMinor || league.weeklyFeeCents <= 0 || !!card,
    alreadySubmitted: !!existing && existing.status !== "REJECTED",
    weekNumber: week?.weekNumber ?? null,
  };
}

export type KioskCheckResult = {
  isScorecard: boolean;
  cardNames: string[];
  settings: { mulligans: boolean | null; gimmeFt: number | null; greens: string | null };
  ok: boolean;
  hard: string[];
  soft: string[];
  warnings: string[];
};

/**
 * Pre-flight: read the current screen (OCR lines only, no image) and tell
 * the kiosk whether a scorecard is up, which names are on it and whether the
 * visible settings pass. Nothing is saved or charged.
 */
export async function kioskCheck(locationId: string, leagueId: string, lines: OcrLine[]): Promise<KioskCheckResult> {
  const league = await loadLeague(leagueId);
  await assertLeagueVisibleAt(league, locationId);
  const parsed = parseScorecard(lines ?? []);
  const check = checkSettings(parsed.settings, { mulligans: league.mulligans, gimmeDistanceFt: league.gimmeDistanceFt, greenSpeed: null });
  const isScorecard = parsed.isScorecard && parsed.players.length > 0;
  return {
    isScorecard,
    cardNames: parsed.players.map((p) => p.name),
    settings: { mulligans: parsed.settings.mulligans, gimmeFt: parsed.settings.gimmeFt, greens: parsed.settings.greens },
    ok: isScorecard && check.ok,
    hard: check.hard,
    soft: check.soft,
    warnings: parsed.warnings,
  };
}

export async function kioskJoin(leagueId: string, phoneDigits: string, displayName?: string | null) {
  const lookup = await kioskLookup(leagueId, phoneDigits);
  const { player, created } = await joinLeague({ leagueId, memberId: lookup.member.id, displayName, via: "KIOSK" });
  return { ...lookup, inLeague: true, player: { id: player.id, displayName: player.displayName, isMinor: player.isMinor, winningsEligible: player.winningsEligible }, created };
}

export type KioskSubmitInput = {
  leagueId: string;
  weekId?: string | null;
  /** PNG/JPEG of the GSPro scorecard screen */
  imageBase64: string;
  imageMime?: string | null;
  ocr: { w: number; h: number; lines: OcrLine[] };
  entries: { phone: string; name: string }[];
};

export type KioskSubmitResult = {
  ok: boolean;
  weekNumber: number;
  rejected: boolean;
  rejectReasons: string[];
  warnings: string[];
  cardNames: string[];
  results: {
    phone: string;
    name: string;
    status: "ACCEPTED" | "FAILED";
    /** FAILED detail so the kiosk can show the right fix */
    code?: string;
    message: string;
    gross?: number;
    front9?: number;
    back9?: number;
    entry?: string;
    feeCents?: number;
    joined?: boolean;
    isMinor?: boolean;
  }[];
};

/**
 * Kiosk scorecard submission: parse the screenshot, verify settings, match
 * each entered name to a row on the card, charge the entry, then save.
 * A player whose card can't be charged is rejected (nothing saved for them);
 * the other players on the card are unaffected.
 */
export async function kioskSubmit(locationId: string, input: KioskSubmitInput): Promise<KioskSubmitResult> {
  const prisma = getPrisma();
  const league = await loadLeague(input.leagueId);
  await assertLeagueVisibleAt(league, locationId);
  const weeks = await prisma.leagueWeek.findMany({ where: { leagueId: league.id } });
  const week = input.weekId ? weeks.find((w) => w.id === input.weekId) ?? null : currentWeekOf(weeks);
  if (!week) throw new LeagueError("No league week is open right now", 409, "NO_OPEN_WEEK");
  assertWeekOpen(week);
  if (!Array.isArray(input.entries) || input.entries.length === 0) throw new LeagueError("Add at least one player", 400, "ENTRIES_REQUIRED");
  if (input.entries.length > 5) throw new LeagueError("Up to 5 players per scorecard", 400, "TOO_MANY_ENTRIES");

  const parsed = parseScorecard(input.ocr?.lines ?? []);
  const warnings = [...parsed.warnings];
  const rejectReasons: string[] = [];
  if (!parsed.isScorecard || parsed.players.length === 0) rejectReasons.push("We couldn't read a scorecard on the screen. Open the scorecard in GSPro (after the 18th hole) and try again.");
  const check = checkSettings(parsed.settings, { mulligans: league.mulligans, gimmeDistanceFt: league.gimmeDistanceFt, greenSpeed: null });
  rejectReasons.push(...check.hard);
  warnings.push(...check.soft);
  const cardNames = parsed.players.map((p) => p.name);

  const image = parseDataUrl(input.imageBase64.startsWith("data:") ? input.imageBase64 : `data:${input.imageMime || "image/png"};base64,${input.imageBase64}`);
  const ocrSettings = { ...parsed.settings, check } as unknown as Record<string, unknown>;

  const results: KioskSubmitResult["results"] = [];
  if (rejectReasons.length) {
    for (const e of input.entries) results.push({ phone: e.phone, name: e.name, status: "FAILED", code: "CARD_REJECTED", message: rejectReasons[0]! });
    return { ok: false, weekNumber: week.weekNumber, rejected: true, rejectReasons, warnings, cardNames, results };
  }

  const usedRows = new Set<ParsedPlayerRow>();
  const seenPhones = new Set<string>();
  for (const e of input.entries) {
    const digits = (e.phone ?? "").replace(/\D/g, "").slice(-10);
    if (seenPhones.has(digits)) {
      results.push({ phone: e.phone, name: e.name, status: "FAILED", code: "DUPLICATE_PHONE", message: "That phone number is already on this submission." });
      continue;
    }
    seenPhones.add(digits);
    try {
      const lookup = await kioskLookup(league.id, e.phone, week.id);
      if (lookup.alreadySubmitted) {
        results.push({ phone: e.phone, name: e.name, status: "FAILED", code: "ALREADY_SUBMITTED", message: `${lookup.member.firstName} already has a week ${week.weekNumber} score. One round per week — no re-dos.` });
        continue;
      }
      // Match the typed name (or the member's name) to a card row.
      const candidates = parsed.players.filter((p) => !usedRows.has(p));
      const typed = e.name?.trim() || `${lookup.member.firstName} ${lookup.member.lastName}`;
      const match =
        bestNameMatch(typed, candidates, (p) => [p.name]) ??
        bestNameMatch(`${lookup.member.firstName} ${lookup.member.lastName}`, candidates, (p) => [p.name]) ??
        bestNameMatch(lookup.member.firstName, candidates, (p) => [p.name], 0.9);
      if (!match) {
        results.push({ phone: e.phone, name: e.name, status: "FAILED", code: "NAME_NOT_ON_CARD", message: `"${typed}" isn't on this scorecard. Names on the card: ${cardNames.join(", ") || "none"}.` });
        continue;
      }
      const row = match.match;
      if (!lookup.canPay) {
        // Fail fast before touching the roster: no card, nothing to charge.
        results.push({ phone: e.phone, name: row.name, status: "FAILED", code: "PAYMENT_REQUIRED", message: `No card on file for the $${(league.weeklyFeeCents / 100).toFixed(0)} weekly entry. ${ADD_CARD_HINT}` });
        continue;
      }
      usedRows.add(row);
      if (!row.consistent) warnings.push(`${row.name}: the hole-by-hole numbers didn't add up to the totals on the card; please check the saved scorecard.`);

      let joined = false;
      let playerId = lookup.player?.id ?? null;
      let isMinor = lookup.player?.isMinor ?? lookup.isMinor;
      if (!lookup.inLeague) {
        const j = await joinLeague({ leagueId: league.id, memberId: lookup.member.id, displayName: typed, via: "KIOSK" });
        joined = j.created;
        playerId = j.player.id;
        isMinor = j.player.isMinor;
      } else if (lookup.player && !lookup.player.displayName && normName(typed) !== normName(`${lookup.member.firstName} ${lookup.member.lastName}`)) {
        // Remember the scorecard name for next time.
        await prisma.leaguePlayer.update({ where: { id: lookup.player.id }, data: { displayName: typed } }).catch(() => {});
      }
      const { score, entry } = await saveScore({
        league,
        week,
        player: { id: playerId!, memberId: lookup.member.id, isMinor },
        holes: cleanHoles(row.holes),
        source: "KIOSK",
        submittedByMemberId: lookup.member.id,
        image,
        ocrText: parsed.text,
        ocrSettings,
        par: parsed.par,
      });
      results.push({
        phone: e.phone,
        name: row.name,
        status: "ACCEPTED",
        message: entry.status === "PAID" ? `Submitted · $${(entry.feeCents / 100).toFixed(0)} charged to card ending ${lookup.card?.last4 ?? "····"}` : "Submitted · no charge (under 18)",
        gross: score.gross,
        front9: score.front9,
        back9: score.back9,
        entry: entry.status,
        feeCents: entry.feeCents,
        joined,
        isMinor,
      });
    } catch (err) {
      results.push({ phone: e.phone, name: e.name, status: "FAILED", code: err instanceof LeagueError ? err.code : "ERROR", message: err instanceof Error ? err.message : "Could not submit" });
    }
  }
  if (warnings.length || results.some((r) => r.status === "FAILED")) {
    void adminNotify({
      organizationId: league.organizationId,
      locationId: league.locationId,
      kind: "league.kiosk-submission",
      severity: results.every((r) => r.status === "FAILED") ? "WARN" : "INFO",
      title: `Kiosk league submission — week ${week.weekNumber}`,
      body: [...results.map((r) => `${r.name}: ${r.status.toLowerCase()} — ${r.message}`), ...warnings].join("\n").slice(0, 1500),
      link: `/admin/league/${league.id}?week=${week.id}`,
    });
  }
  return { ok: results.some((r) => r.status === "ACCEPTED"), weekNumber: week.weekNumber, rejected: false, rejectReasons, warnings, cardNames, results };
}

/* ───────────────────────────── finalize / compute ───────────────────────────── */

/** Cron: finalize every week whose deadline has passed. */
export async function runLeagueDeadlines(now = new Date()) {
  const prisma = getPrisma();
  const due = await prisma.leagueWeek.findMany({ where: { deadlineAt: { lte: now }, finalizedAt: null, league: { status: { in: ["OPEN", "ACTIVE"] } } }, select: { id: true, leagueId: true, weekNumber: true }, orderBy: [{ leagueId: "asc" }, { weekNumber: "asc" }] });
  const done: string[] = [];
  for (const w of due) {
    try {
      await computeWeek(w.id, { recompute: false });
      done.push(w.id);
    } catch (e) {
      console.error(`[league] finalize week ${w.id} failed`, e);
    }
  }
  return { finalized: done.length, weekIds: done };
}

/**
 * Reveal + compute a week. Idempotent; `recompute` re-runs a finalized week
 * (after an admin edits a score) and reverses its previous payouts/pot moves.
 */
export async function computeWeek(weekId: string, opts: { recompute?: boolean; actorId?: string } = {}) {
  const prisma = getPrisma();
  const week = await prisma.leagueWeek.findUnique({ where: { id: weekId }, include: { league: { include: { location: { select: { id: true, name: true, slug: true, timezone: true, organizationId: true } } } } } });
  if (!week) throw new LeagueError("Week not found", 404, "WEEK_NOT_FOUND");
  if (week.finalizedAt && !opts.recompute) return { weekId, skipped: true };
  const league = week.league;
  const hs = hcSettings(league);
  const ps = ptSettings(league);

  const [allWeeks, players, allScores, pastResults] = await Promise.all([
    prisma.leagueWeek.findMany({ where: { leagueId: league.id }, orderBy: { weekNumber: "asc" } }),
    prisma.leaguePlayer.findMany({ where: { leagueId: league.id }, include: { member: { select: { firstName: true, lastName: true } } } }),
    prisma.leagueScore.findMany({ where: { leagueId: league.id, status: { not: "REJECTED" } }, include: { week: { select: { weekNumber: true } } } }),
    prisma.leagueWeekResult.findMany({ where: { week: { leagueId: league.id } } }),
  ]);
  void pastResults;

  // Weeks that are closed = every week whose deadline has passed up to and including this one.
  const revealedWeeks = new Set(allWeeks.filter((w) => w.weekNumber <= week.weekNumber && (w.revealedAt || w.id === week.id)).map((w) => w.weekNumber));
  const scoresFlat = allScores.map((s) => ({ playerId: s.playerId, weekNumber: s.week.weekNumber, gross: s.gross, id: s.id, holes: s.holes as number[], weekId: s.weekId }));
  const lows = weekLows(scoresFlat);
  const byPlayer = new Map<string, typeof scoresFlat>();
  for (const s of scoresFlat) byPlayer.set(s.playerId, [...(byPlayer.get(s.playerId) ?? []), s]);

  await prisma.$transaction(async (tx) => {
    // 1. Reveal + accept every submitted score of this week.
    await tx.leagueScore.updateMany({ where: { weekId: week.id, status: "SUBMITTED" }, data: { status: "ACCEPTED" } });

    // 2. Handicaps in force for this week (+ retroactively for opening weeks when the opening period just closed).
    const targetWeeks = week.weekNumber === league.openingWeeks ? allWeeks.filter((w) => w.weekNumber <= league.openingWeeks) : [week];
    const weekLow = lows.get(week.weekNumber);
    for (const tw of targetWeeks) {
      const twLow = lows.get(tw.weekNumber);
      for (const p of players) {
        const hc = handicapForWeek({ weekNumber: tw.weekNumber, playerScores: byPlayer.get(p.id) ?? [], lows, revealedWeeks, settings: hs });
        const mine = (byPlayer.get(p.id) ?? []).find((s) => s.weekNumber === tw.weekNumber);
        const sb = mine && twLow !== undefined ? strokesBack(mine.gross, twLow, hs.handicapCap) : null;
        if (hc || sb != null) {
          await tx.leagueHandicap.upsert({
            where: { weekId_playerId: { weekId: tw.id, playerId: p.id } },
            create: { weekId: tw.id, playerId: p.id, handicap: hc?.handicap ?? 0, strokesBack: sb, roundsUsed: hc?.roundsUsed ?? 0 },
            update: { handicap: hc?.handicap ?? 0, strokesBack: sb, roundsUsed: hc?.roundsUsed ?? 0, computedAt: new Date() },
          });
        }
        if (mine) await tx.leagueScore.update({ where: { id: mine.id }, data: { handicap: hc?.handicap ?? null, net: hc ? mine.gross - hc.handicap : null } });
      }
    }
    void weekLow;

    // 2b. When the opening period just closed, the earlier opening weeks now
    // have handicaps: fill in their handicapped ranks + points. Money for those
    // weeks was already settled when they closed and is left untouched.
    for (const tw of targetWeeks) {
      if (tw.id === week.id) continue;
      const twScores = scoresFlat.filter((s) => s.weekNumber === tw.weekNumber);
      const twHc = new Map<string, number | null>();
      for (const s of twScores) twHc.set(s.playerId, handicapForWeek({ weekNumber: tw.weekNumber, playerScores: byPlayer.get(s.playerId) ?? [], lows, revealedWeeks, settings: hs })?.handicap ?? null);
      const twNetRanks = rankByScore(twScores.filter((s) => twHc.get(s.playerId) != null), (s) => s.gross - (twHc.get(s.playerId) as number));
      const twResults = await tx.leagueWeekResult.findMany({ where: { weekId: tw.id } });
      for (const r of twResults) {
        const sc = twScores.find((x) => x.playerId === r.playerId);
        const netRank = sc ? twNetRanks.get(sc) ?? null : null;
        const netPoints = pointsForRank(netRank, ps);
        if (netRank !== r.netRank || netPoints !== r.netPoints) {
          await tx.leagueWeekResult.update({ where: { id: r.id }, data: { netRank, netPoints, totalPoints: r.grossPoints + netPoints + r.teamPoints } });
        }
      }
    }

    // 3. Ranks + individual points for this week.
    const thisWeek = scoresFlat.filter((s) => s.weekNumber === week.weekNumber);
    const hcMap = new Map<string, number | null>();
    for (const s of thisWeek) {
      const hc = handicapForWeek({ weekNumber: week.weekNumber, playerScores: byPlayer.get(s.playerId) ?? [], lows, revealedWeeks, settings: hs });
      hcMap.set(s.playerId, hc?.handicap ?? null);
    }
    const grossRanks = rankByScore(thisWeek, (s) => s.gross);
    const netRows = thisWeek.filter((s) => hcMap.get(s.playerId) != null);
    const netRanks = rankByScore(netRows, (s) => s.gross - (hcMap.get(s.playerId) as number));

    // 4. Team matches for this week (teams were drawn when the previous week closed; draw now if missing).
    let teams = await tx.leagueTeam.findMany({ where: { weekId: week.id } });
    let matches = await tx.leagueMatch.findMany({ where: { weekId: week.id } });
    if (teams.length === 0) {
      const active = players.filter((p) => p.active && (byPlayer.get(p.id) ?? []).some((s) => s.weekNumber <= week.weekNumber));
      const drawn = await drawTeamsForWeek(tx, league.id, week.id, active.map((p) => ({ playerId: p.id, handicap: hcMap.get(p.id) ?? null })), allWeeks.filter((w) => w.weekNumber < week.weekNumber).map((w) => w.id));
      teams = drawn.teams;
      matches = drawn.matches;
    }
    const cardOf = (pid: string | null): HoleCard => {
      if (!pid) return null;
      const s = thisWeek.find((x) => x.playerId === pid);
      return s && Array.isArray(s.holes) && s.holes.length === 18 ? s.holes : null;
    };
    const teamPoints = new Map<string, number>();
    const teamWinners: string[] = [];
    const teamMargins: { teamId: string; margin: number; bestBallTotal: number; players: string[] }[] = [];
    const bestBallTotal = (cards: HoleCard[]) => {
      const bb = bestBall(cards);
      return bb.every((h) => h != null) ? sum(bb as number[]) : Number.POSITIVE_INFINITY;
    };
    for (const m of matches) {
      const t1 = teams.find((t) => t.id === m.team1Id)!;
      const t2 = m.team2Id ? teams.find((t) => t.id === m.team2Id) ?? null : null;
      const t1Cards = [cardOf(t1.player1Id), cardOf(t1.player2Id)];
      const t2Cards = t2 ? [cardOf(t2.player1Id), cardOf(t2.player2Id)] : null;
      const r = playMatch(t1Cards, t2Cards);
      const winnerTeamId = r.winner === 1 ? t1.id : r.winner === 2 ? t2?.id ?? null : null;
      await tx.leagueMatch.update({ where: { id: m.id }, data: { team1Holes: r.team1Holes, team2Holes: r.team2Holes, winnerTeamId, outcome: r.outcome, computedAt: new Date() } });
      const give = (t: typeof t1 | null, pts: number) => {
        if (!t) return;
        for (const pid of [t.player1Id, t.player2Id]) if (pid) teamPoints.set(pid, (teamPoints.get(pid) ?? 0) + pts);
      };
      if (r.outcome === "TIE") {
        give(t1, ps.pointsTeamTie);
        give(t2, ps.pointsTeamTie);
      } else if (winnerTeamId) {
        const wt = winnerTeamId === t1.id ? t1 : t2;
        give(wt, ps.pointsTeamWin);
        if (wt) {
          teamWinners.push(wt.id);
          if (r.outcome === "PLAYED") teamMargins.push({ teamId: wt.id, margin: Math.abs(r.team1Holes - r.team2Holes), bestBallTotal: bestBallTotal(wt.id === t1.id ? t1Cards : t2Cards!), players: [wt.player1Id, wt.player2Id].filter(Boolean) as string[] });
        }
      }
    }
    // "Team of the week" for money: the match winner with the largest hole
    // margin; a tie on margin is broken by the lower best-ball total, and a
    // tie on both shares the slot.
    teamMargins.sort((a, b) => b.margin - a.margin || a.bestBallTotal - b.bestBallTotal);
    const sameSlot = (a: (typeof teamMargins)[number], b: (typeof teamMargins)[number]) => a.margin === b.margin && a.bestBallTotal === b.bestBallTotal;
    const firstTeams = teamMargins.length ? teamMargins.filter((t) => sameSlot(t, teamMargins[0]!)) : [];
    const runnerUp = teamMargins.find((t) => !sameSlot(t, teamMargins[0]!)) ?? null;
    const secondTeams = runnerUp ? teamMargins.filter((t) => sameSlot(t, runnerUp)) : [];

    // 5. Results rows.
    await tx.leagueWeekResult.deleteMany({ where: { weekId: week.id } });
    const resultRows: Prisma.LeagueWeekResultCreateManyInput[] = [];
    const participants = new Set<string>([...thisWeek.map((s) => s.playerId), ...teamPoints.keys()]);
    for (const pid of participants) {
      const s = thisWeek.find((x) => x.playerId === pid);
      const grossRank = s ? grossRanks.get(s) ?? null : null;
      const netRank = s ? netRanks.get(s) ?? null : null;
      const grossPoints = pointsForRank(grossRank, ps);
      const netPoints = pointsForRank(netRank, ps);
      const tp = teamPoints.get(pid) ?? 0;
      resultRows.push({ weekId: week.id, playerId: pid, grossRank, netRank, grossPoints, netPoints, teamPoints: tp, totalPoints: grossPoints + netPoints + tp, payoutCents: 0 });
    }
    if (resultRows.length) await tx.leagueWeekResult.createMany({ data: resultRows });

    // 6. Money. Reverse this week's previous payouts / pot move when recomputing.
    const prevPayouts = await tx.leaguePayout.findMany({ where: { weekId: week.id } });
    if (prevPayouts.length || week.toChampionshipCents) {
      await tx.leaguePayout.deleteMany({ where: { weekId: week.id, kind: { not: "ADJUSTMENT" } } });
      await tx.league.update({ where: { id: league.id }, data: { championshipPotCents: { decrement: week.toChampionshipCents } } });
    }
    const potAgg = await tx.leagueEntry.aggregate({ where: { weekId: week.id, status: "PAID" }, _sum: { feeCents: true } });
    const potCents = potAgg._sum.feeCents ?? 0;
    const paidEntries = new Set((await tx.leagueEntry.findMany({ where: { weekId: week.id, status: { in: ["PAID", "WAIVED"] } }, select: { playerId: true } })).map((e) => e.playerId));
    const eligible = (pid: string) => {
      const p = players.find((x) => x.id === pid);
      return !!p && p.winningsEligible && !p.isMinor && paidEntries.has(pid);
    };
    const idsAtRank = (ranks: Map<(typeof thisWeek)[number], number>, rank: number) => [...ranks.entries()].filter(([, r]) => r === rank).map(([s]) => s.playerId);
    const pay = weeklyPayouts({
      potCents,
      settings: { firstPlacePct: league.firstPlacePct, firstPlaceCapCents: league.firstPlaceCapCents, secondPlacePct: league.secondPlacePct, secondPlaceCapCents: league.secondPlaceCapCents },
      first: { gross: idsAtRank(grossRanks, 1), net: idsAtRank(netRanks, 1), team: firstTeams.flatMap((t) => t.players) },
      second: { gross: idsAtRank(grossRanks, 2), net: idsAtRank(netRanks, 2), team: secondTeams.flatMap((t) => t.players) },
      eligible,
    });
    if (pay.lines.length) {
      await tx.leaguePayout.createMany({ data: pay.lines.map((l) => ({ leagueId: league.id, weekId: week.id, playerId: l.playerId, amountCents: l.amountCents, kind: l.kind as PayoutKind, note: payoutNote(l.kind as PayoutKind, week.weekNumber) })) });
      for (const l of pay.lines) await tx.leagueWeekResult.updateMany({ where: { weekId: week.id, playerId: l.playerId }, data: { payoutCents: { increment: l.amountCents } } });
    }
    await tx.league.update({ where: { id: league.id }, data: { championshipPotCents: { increment: pay.toChampionshipCents }, status: league.status === "OPEN" ? "ACTIVE" : undefined } });
    await tx.leagueWeek.update({ where: { id: week.id }, data: { potCents, paidOutCents: pay.paidOutCents, toChampionshipCents: pay.toChampionshipCents, revealedAt: week.revealedAt ?? new Date(), finalizedAt: new Date() } });

    // 7. Next week: handicaps in force + teams.
    const next = allWeeks.find((w) => w.weekNumber === week.weekNumber + 1);
    if (next) {
      const revealedPlusThis = new Set([...revealedWeeks, week.weekNumber]);
      const nextHc = new Map<string, number | null>();
      for (const p of players) {
        const hc = handicapForWeek({ weekNumber: next.weekNumber, playerScores: byPlayer.get(p.id) ?? [], lows, revealedWeeks: revealedPlusThis, settings: hs });
        nextHc.set(p.id, hc?.handicap ?? null);
        if (hc) {
          await tx.leagueHandicap.upsert({
            where: { weekId_playerId: { weekId: next.id, playerId: p.id } },
            create: { weekId: next.id, playerId: p.id, handicap: hc.handicap, roundsUsed: hc.roundsUsed },
            update: { handicap: hc.handicap, roundsUsed: hc.roundsUsed, computedAt: new Date() },
          });
        }
      }
      // Teams for next week: every active player who has played at least once this season.
      await tx.leagueMatch.deleteMany({ where: { weekId: next.id } });
      await tx.leagueTeam.deleteMany({ where: { weekId: next.id } });
      const active = players.filter((p) => p.active && (byPlayer.get(p.id) ?? []).length > 0);
      await drawTeamsForWeek(tx, league.id, next.id, active.map((p) => ({ playerId: p.id, handicap: nextHc.get(p.id) ?? null })), allWeeks.filter((w) => w.weekNumber <= week.weekNumber).map((w) => w.id));
    }
  }, { timeout: 60_000, maxWait: 10_000 });

  void audit({ organizationId: league.organizationId, actorId: opts.actorId, action: "league.week-finalize", entityType: "LeagueWeek", entityId: week.id, metadata: { recompute: !!opts.recompute } });
  return { weekId, skipped: false };
}

function payoutNote(kind: PayoutKind, weekNumber: number) {
  const label: Record<PayoutKind, string> = { GROSS_1: "1st · straight", GROSS_2: "2nd · straight", NET_1: "1st · handicapped", NET_2: "2nd · handicapped", TEAM_1: "Team of the week", TEAM_2: "2nd team" };
  return `Week ${weekNumber} — ${label[kind]}`;
}

async function drawTeamsForWeek(tx: Prisma.TransactionClient, leagueId: string, weekId: string, pairable: { playerId: string; handicap: number | null }[], historyWeekIds: string[]) {
  void leagueId;
  const history = { partners: new Set<string>(), opponents: new Set<string>() };
  if (historyWeekIds.length) {
    const past = await tx.leagueTeam.findMany({ where: { weekId: { in: historyWeekIds } }, include: { homeMatches: { include: { team2: true } } } });
    for (const t of past) {
      if (t.player2Id) history.partners.add(pairKey(t.player1Id, t.player2Id));
      for (const m of t.homeMatches) {
        if (!m.team2) continue;
        for (const a of [t.player1Id, t.player2Id]) for (const b of [m.team2.player1Id, m.team2.player2Id]) if (a && b) history.opponents.add(pairKey(a, b));
      }
    }
  }
  const seed = [...weekId].reduce((s, c) => s + c.charCodeAt(0), 0);
  const drawn = drawTeams(pairable, history, seed);
  const teams = [];
  for (const t of drawn.teams) teams.push(await tx.leagueTeam.create({ data: { weekId, teamNumber: t.teamNumber, player1Id: t.player1Id, player2Id: t.player2Id } }));
  const matches = [];
  for (const m of drawn.matches) {
    const t1 = teams.find((t) => t.teamNumber === m.team1)!;
    const t2 = m.team2 ? teams.find((t) => t.teamNumber === m.team2) ?? null : null;
    matches.push(await tx.leagueMatch.create({ data: { weekId, team1Id: t1.id, team2Id: t2?.id ?? null, outcome: t2 ? "NOT_PLAYED" : "BYE" } }));
  }
  return { teams, matches };
}

/** Admin: redraw an upcoming (not finalized) week's teams. */
export async function regenerateTeams(weekId: string, actorId?: string) {
  const prisma = getPrisma();
  const week = await prisma.leagueWeek.findUnique({ where: { id: weekId }, include: { league: true } });
  if (!week) throw new LeagueError("Week not found", 404, "WEEK_NOT_FOUND");
  if (week.finalizedAt) throw new LeagueError("This week is finalized; edit scores instead.", 409, "WEEK_FINALIZED");
  const [players, hcs, weeks] = await Promise.all([
    prisma.leaguePlayer.findMany({ where: { leagueId: week.leagueId, active: true }, include: { _count: { select: { scores: { where: { status: { not: "REJECTED" } } } } } } }),
    prisma.leagueHandicap.findMany({ where: { weekId } }),
    prisma.leagueWeek.findMany({ where: { leagueId: week.leagueId, weekNumber: { lt: week.weekNumber } }, select: { id: true } }),
  ]);
  const hcMap = new Map(hcs.map((h) => [h.playerId, h.handicap]));
  const pairable = players.filter((p) => p._count.scores > 0 || week.weekNumber === 1).map((p) => ({ playerId: p.id, handicap: hcMap.get(p.id) ?? null }));
  await prisma.$transaction(async (tx) => {
    await tx.leagueMatch.deleteMany({ where: { weekId } });
    await tx.leagueTeam.deleteMany({ where: { weekId } });
    await drawTeamsForWeek(tx, week.leagueId, weekId, pairable, weeks.map((w) => w.id));
  });
  void audit({ organizationId: week.league.organizationId, actorId, action: "league.teams-redraw", entityType: "LeagueWeek", entityId: weekId });
  return { ok: true, teams: pairable.length };
}

/** Admin: championship payouts (100% of the pot given away) and close the league. */
export async function awardChampionship(leagueId: string, awards: { playerId: string; amountCents: number; note?: string | null }[], actorId: string) {
  const prisma = getPrisma();
  const league = await loadLeague(leagueId);
  const total = awards.reduce((s, a) => s + Math.max(0, Math.round(a.amountCents)), 0);
  if (total > league.championshipPotCents) throw new LeagueError(`Awards ($${(total / 100).toFixed(2)}) exceed the championship pot ($${(league.championshipPotCents / 100).toFixed(2)})`, 400, "POT_EXCEEDED");
  await prisma.$transaction(async (tx) => {
    if (awards.length) await tx.leaguePayout.createMany({ data: awards.filter((a) => a.amountCents > 0).map((a) => ({ leagueId, playerId: a.playerId, amountCents: Math.round(a.amountCents), kind: "CHAMPIONSHIP", note: a.note?.trim() || "League Championship" })) });
    await tx.league.update({ where: { id: leagueId }, data: { championshipPotCents: { decrement: total }, status: "COMPLETE" } });
  });
  void audit({ organizationId: league.organizationId, actorId, action: "league.championship-award", entityType: "League", entityId: leagueId, metadata: { total, awards: awards.length } });
  return { ok: true, total };
}

export async function markPayoutPaid(payoutId: string, paid: boolean, actorId: string) {
  const prisma = getPrisma();
  const p = await prisma.leaguePayout.update({ where: { id: payoutId }, data: { paidAt: paid ? new Date() : null } });
  void audit({ actorId, action: "league.payout-paid", entityType: "LeaguePayout", entityId: payoutId, metadata: { paid } });
  return p;
}

/* ───────────────────────────── read models ───────────────────────────── */

export type StandingRow = { playerId: string; name: string; memberId: string; points: number; grossPoints: number; netPoints: number; teamPoints: number; rounds: number; earningsCents: number; isMinor: boolean; winningsEligible: boolean; handicap: number | null; rank: number; championshipQualified: boolean };

export async function leagueStandings(leagueId: string): Promise<StandingRow[]> {
  const prisma = getPrisma();
  const league = await loadLeague(leagueId);
  const [players, results, payouts, latestHc] = await Promise.all([
    prisma.leaguePlayer.findMany({ where: { leagueId, active: true }, include: { member: { select: { firstName: true, lastName: true } }, _count: { select: { scores: { where: { status: "ACCEPTED", week: { finalizedAt: { not: null } } } } } } } }),
    prisma.leagueWeekResult.findMany({ where: { week: { leagueId, finalizedAt: { not: null } } } }),
    prisma.leaguePayout.findMany({ where: { leagueId } }),
    prisma.leagueHandicap.findMany({ where: { week: { leagueId }, player: { active: true } }, include: { week: { select: { weekNumber: true } } }, orderBy: { week: { weekNumber: "desc" } } }),
  ]);
  const hcByPlayer = new Map<string, number>();
  for (const h of latestHc) if (h.roundsUsed > 0 && !hcByPlayer.has(h.playerId)) hcByPlayer.set(h.playerId, h.handicap);
  const rows: StandingRow[] = players.map((p) => {
    const mine = results.filter((r) => r.playerId === p.id);
    const earnings = payouts.filter((x) => x.playerId === p.id).reduce((s, x) => s + x.amountCents, 0);
    return {
      playerId: p.id,
      memberId: p.memberId,
      name: playerName(p),
      points: mine.reduce((s, r) => s + r.totalPoints, 0),
      grossPoints: mine.reduce((s, r) => s + r.grossPoints, 0),
      netPoints: mine.reduce((s, r) => s + r.netPoints, 0),
      teamPoints: mine.reduce((s, r) => s + r.teamPoints, 0),
      rounds: p._count.scores,
      earningsCents: earnings,
      isMinor: p.isMinor,
      winningsEligible: p.winningsEligible,
      handicap: hcByPlayer.get(p.id) ?? null,
      rank: 0,
      championshipQualified: false,
    };
  });
  rows.sort((a, b) => b.points - a.points || b.grossPoints - a.grossPoints || b.rounds - a.rounds || a.name.localeCompare(b.name));
  let rank = 0;
  let prev: number | null = null;
  rows.forEach((r, i) => {
    if (prev === null || r.points !== prev) rank = i + 1;
    prev = r.points;
    r.rank = rank;
  });
  const cutoff = Math.max(1, Math.ceil((rows.filter((r) => r.rounds > 0).length * league.championshipTopPct) / 100));
  for (const r of rows) r.championshipQualified = r.rounds > 0 && r.rank <= cutoff;
  return rows;
}

export type WeekView = {
  id: string;
  weekNumber: number;
  courseName: string | null;
  opensAt: string;
  deadlineAt: string;
  deadlineLabel: string;
  isChampionship: boolean;
  status: "UPCOMING" | "OPEN" | "CLOSED" | "FINAL";
  potCents: number;
  submittedCount: number;
  revealed: boolean;
  teams: { teamNumber: number; players: { playerId: string; name: string }[]; opponentTeamNumber: number | null; holesFor: number; holesAgainst: number; outcome: string; won: boolean | null }[];
  results: { playerId: string; name: string; gross: number | null; handicap: number | null; net: number | null; grossRank: number | null; netRank: number | null; points: number; payoutCents: number; }[] | null;
  payouts: { playerId: string; name: string; kind: string; amountCents: number }[];
  toChampionshipCents: number;
};

export async function leagueWeeks(leagueId: string, now = new Date()): Promise<WeekView[]> {
  const prisma = getPrisma();
  const league = await loadLeague(leagueId);
  const weeks = await prisma.leagueWeek.findMany({
    where: { leagueId },
    orderBy: { weekNumber: "asc" },
    include: {
      _count: { select: { scores: { where: { status: { not: "REJECTED" } } } } },
      teams: { include: { player1: { include: { member: { select: { firstName: true, lastName: true } } } }, player2: { include: { member: { select: { firstName: true, lastName: true } } } }, homeMatches: true, awayMatches: true }, orderBy: { teamNumber: "asc" } },
      scores: { where: { status: "ACCEPTED" }, include: { player: { include: { member: { select: { firstName: true, lastName: true } } } } } },
      results: true,
      payouts: { include: { player: { include: { member: { select: { firstName: true, lastName: true } } } } } },
    },
  });
  return weeks.map((w) => {
    const revealed = !!w.revealedAt;
    const teamNumById = new Map(w.teams.map((t) => [t.id, t.teamNumber]));
    return {
      id: w.id,
      weekNumber: w.weekNumber,
      courseName: w.courseName,
      opensAt: w.opensAt.toISOString(),
      deadlineAt: w.deadlineAt.toISOString(),
      deadlineLabel: fmtDeadline(w.deadlineAt, league.location.timezone),
      isChampionship: w.isChampionship,
      status: w.finalizedAt ? "FINAL" : now < w.opensAt ? "UPCOMING" : now <= w.deadlineAt ? "OPEN" : "CLOSED",
      potCents: w.potCents,
      submittedCount: w._count.scores,
      revealed,
      teams: w.teams.map((t) => {
        const m = t.homeMatches[0] ?? t.awayMatches[0] ?? null;
        const isHome = !!t.homeMatches[0];
        const opp = m ? (isHome ? m.team2Id : m.team1Id) : null;
        const holesFor = m ? (isHome ? m.team1Holes : m.team2Holes) : 0;
        const holesAgainst = m ? (isHome ? m.team2Holes : m.team1Holes) : 0;
        return {
          teamNumber: t.teamNumber,
          players: [t.player1, t.player2].filter(Boolean).map((p) => ({ playerId: p!.id, name: playerName(p!) })),
          opponentTeamNumber: opp ? teamNumById.get(opp) ?? null : null,
          holesFor,
          holesAgainst,
          outcome: m?.outcome ?? "NOT_PLAYED",
          won: m?.computedAt ? (m.winnerTeamId ? m.winnerTeamId === t.id : null) : null,
        };
      }),
      results: revealed
        ? w.scores
            .map((s) => {
              const r = w.results.find((x) => x.playerId === s.playerId);
              return { playerId: s.playerId, name: playerName(s.player), gross: s.gross, handicap: s.handicap, net: s.net, grossRank: r?.grossRank ?? null, netRank: r?.netRank ?? null, points: r?.totalPoints ?? 0, payoutCents: r?.payoutCents ?? 0 };
            })
            .sort((a, b) => (a.grossRank ?? 999) - (b.grossRank ?? 999))
        : null,
      payouts: w.payouts.map((p) => ({ playerId: p.playerId, name: playerName(p.player), kind: p.kind, amountCents: p.amountCents })),
      toChampionshipCents: w.toChampionshipCents,
    };
  });
}

export async function playerProfile(leagueId: string, playerId: string, viewerMemberId?: string | null) {
  const prisma = getPrisma();
  const league = await loadLeague(leagueId);
  const p = await prisma.leaguePlayer.findFirst({
    where: { id: playerId, leagueId },
    include: {
      member: { select: { id: true, firstName: true, lastName: true } },
      scores: { where: { status: { not: "REJECTED" } }, include: { week: true }, orderBy: { week: { weekNumber: "asc" } } },
      results: { include: { week: { select: { weekNumber: true } } } },
      payouts: { include: { week: { select: { weekNumber: true } } }, orderBy: { createdAt: "asc" } },
      handicaps: { include: { week: { select: { weekNumber: true } } }, orderBy: { week: { weekNumber: "asc" } } },
      teamsAs1: { include: { week: { select: { weekNumber: true } }, player2: { include: { member: { select: { firstName: true, lastName: true } } } }, homeMatches: true } },
      teamsAs2: { include: { week: { select: { weekNumber: true } }, player1: { include: { member: { select: { firstName: true, lastName: true } } } }, awayMatches: true } },
    },
  });
  if (!p) throw new LeagueError("Player not found", 404, "PLAYER_NOT_FOUND");
  const standings = await leagueStandings(leagueId);
  const me = standings.find((s) => s.playerId === playerId) ?? null;
  const isSelf = !!viewerMemberId && viewerMemberId === p.memberId;
  const revealedScores = p.scores.filter((s) => s.week.revealedAt);
  const grossList = revealedScores.map((s) => s.gross);
  const holesAll = revealedScores.flatMap((s) => (Array.isArray(s.holes) ? (s.holes as number[]) : []));
  const netList = revealedScores.filter((s) => s.net != null).map((s) => s.net as number);
  const sbList = p.handicaps.filter((h) => h.strokesBack != null).map((h) => h.strokesBack as number);
  // Hole results vs par, only for rounds where the card showed a par row.
  let birdiesOrBetter = 0;
  let pars = 0;
  let bogeys = 0;
  let doublePlus = 0;
  let holesWithPar = 0;
  for (const s of revealedScores) {
    const par = Array.isArray(s.par) ? (s.par as number[]) : null;
    const holes = Array.isArray(s.holes) ? (s.holes as number[]) : null;
    if (!par || !holes || par.length !== 18 || holes.length !== 18) continue;
    for (let i = 0; i < 18; i++) {
      const d = holes[i]! - par[i]!;
      holesWithPar++;
      if (d <= -1) birdiesOrBetter++;
      else if (d === 0) pars++;
      else if (d === 1) bogeys++;
      else doublePlus++;
    }
  }
  const stats = {
    rounds: revealedScores.length,
    avgGross: grossList.length ? Math.round((sum(grossList) / grossList.length) * 10) / 10 : null,
    bestGross: grossList.length ? Math.min(...grossList) : null,
    worstGross: grossList.length ? Math.max(...grossList) : null,
    avgNet: netList.length ? Math.round((sum(netList) / netList.length) * 10) / 10 : null,
    bestNet: netList.length ? Math.min(...netList) : null,
    avgStrokesBack: sbList.length ? Math.round((sum(sbList) / sbList.length) * 10) / 10 : null,
    avgFront9: revealedScores.length ? Math.round((sum(revealedScores.map((s) => s.front9)) / revealedScores.length) * 10) / 10 : null,
    avgBack9: revealedScores.length ? Math.round((sum(revealedScores.map((s) => s.back9)) / revealedScores.length) * 10) / 10 : null,
    holesWithPar,
    birdiesOrBetter,
    pars,
    bogeys,
    doublePlus,
    avgPerHole: holesAll.length ? Math.round((sum(holesAll) / holesAll.length) * 100) / 100 : null,
    teamWins: 0,
    teamLosses: 0,
    teamTies: 0,
  };
  const teams = [
    ...p.teamsAs1.map((t) => ({ weekNumber: t.week.weekNumber, partner: t.player2 ? playerName(t.player2) : null, match: t.homeMatches[0] ?? null, mine: t.id })),
    ...p.teamsAs2.map((t) => ({ weekNumber: t.week.weekNumber, partner: playerName(t.player1), match: t.awayMatches[0] ?? null, mine: t.id })),
  ].sort((a, b) => a.weekNumber - b.weekNumber);
  for (const t of teams) {
    if (!t.match?.computedAt) continue;
    if (t.match.outcome === "TIE") stats.teamTies++;
    else if (t.match.winnerTeamId === t.mine) stats.teamWins++;
    else if (t.match.winnerTeamId) stats.teamLosses++;
  }
  return {
    league: { id: league.id, name: league.name, timezone: league.location.timezone },
    player: { id: p.id, memberId: p.memberId, name: playerName(p), isMinor: p.isMinor, winningsEligible: p.winningsEligible, joinedAt: p.joinedAt.toISOString(), isSelf },
    standing: me,
    stats,
    earningsCents: p.payouts.reduce((s, x) => s + x.amountCents, 0),
    payouts: p.payouts.map((x) => ({ id: x.id, weekNumber: x.week?.weekNumber ?? null, kind: x.kind, amountCents: x.amountCents, note: x.note, paidAt: x.paidAt?.toISOString() ?? null })),
    // handicap is null for straight weeks (opening period / no prior rounds); strokesBack is still recorded.
    handicaps: p.handicaps.map((h) => ({ weekNumber: h.week.weekNumber, handicap: h.roundsUsed > 0 ? h.handicap : null, strokesBack: h.strokesBack, roundsUsed: h.roundsUsed })),
    rounds: p.scores.map((s) => {
      const r = p.results.find((x) => x.weekId === s.weekId);
      const hidden = !s.week.revealedAt;
      return {
        id: s.id,
        weekId: s.weekId,
        weekNumber: s.week.weekNumber,
        courseName: s.week.courseName,
        hidden,
        status: s.status,
        submittedAt: s.submittedAt.toISOString(),
        holes: hidden ? null : (s.holes as number[]),
        par: hidden || !Array.isArray(s.par) ? null : (s.par as number[]),
        front9: hidden ? null : s.front9,
        back9: hidden ? null : s.back9,
        gross: hidden ? null : s.gross,
        handicap: hidden ? null : s.handicap,
        net: hidden ? null : s.net,
        grossRank: r?.grossRank ?? null,
        netRank: r?.netRank ?? null,
        points: r?.totalPoints ?? 0,
        payoutCents: r?.payoutCents ?? 0,
        imageId: s.imageId,
        source: s.source,
      };
    }),
    teams: teams.map((t) => ({ weekNumber: t.weekNumber, partner: t.partner, outcome: t.match?.outcome ?? "NOT_PLAYED", won: t.match?.computedAt ? (t.match.winnerTeamId ? t.match.winnerTeamId === t.mine : null) : null })),
  };
}

/** Everything a member needs for the league hub in the app. */
export async function memberLeagueOverview(memberId: string, now = new Date()) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, firstName: true, lastName: true, dob: true, locationId: true, homeLocationId: true, organizationId: true, paymentMethods: { where: { status: { not: "EXPIRED" }, squareCardId: { not: null } }, select: { last4: true, brand: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }], take: 1 } } });
  if (!member) throw new LeagueError("Member not found", 404, "MEMBER_NOT_FOUND");
  const leagues = await prisma.league.findMany({
    where: { status: { in: ["OPEN", "ACTIVE", "COMPLETE"] }, ...(member.organizationId ? { OR: [{ organizationId: member.organizationId }, { locationId: member.locationId }] } : {}) },
    include: { location: { select: { id: true, name: true, slug: true, timezone: true } }, weeks: { orderBy: { weekNumber: "asc" }, include: { _count: { select: { scores: { where: { status: { not: "REJECTED" } } } } } } }, players: { where: { memberId }, include: { scores: { select: { weekId: true, status: true } }, entries: { select: { weekId: true, status: true } } } }, _count: { select: { players: { where: { active: true } } } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const homeId = member.homeLocationId ?? member.locationId;
  const out = [];
  for (const l of leagues) {
    const me = l.players[0] ?? null;
    const standings = await leagueStandings(l.id);
    const myRow = me ? standings.find((s) => s.playerId === me.id) ?? null : null;
    const cur = currentWeekOf(l.weeks, now);
    const myHc = me ? await prisma.leagueHandicap.findFirst({ where: { playerId: me.id, roundsUsed: { gt: 0 } }, orderBy: { week: { weekNumber: "desc" } } }) : null;
    out.push({
      id: l.id,
      name: l.name,
      status: l.status,
      location: l.location,
      isHome: l.locationId === homeId,
      playerCount: l._count.players,
      weeklyFeeCents: l.weeklyFeeCents,
      championshipAt: l.championshipAt?.toISOString() ?? null,
      championshipNote: l.championshipNote,
      championshipPotCents: l.championshipPotCents,
      championshipTopPct: l.championshipTopPct,
      settings: { gimmeDistanceFt: l.gimmeDistanceFt, mulligans: l.mulligans, greenSpeed: l.greenSpeed, teeRules: l.teeRules, openingWeeks: l.openingWeeks, handicapCap: l.handicapCap, throwOutEvery: l.throwOutEvery, pointsTop5: l.pointsTop5, pointsTop10: l.pointsTop10, pointsTop15: l.pointsTop15, pointsTeamWin: l.pointsTeamWin, pointsTeamTie: l.pointsTeamTie, firstPlacePct: l.firstPlacePct, firstPlaceCapCents: l.firstPlaceCapCents, secondPlacePct: l.secondPlacePct, secondPlaceCapCents: l.secondPlaceCapCents, minorAge: l.minorAge, weeklyFeeCents: l.weeklyFeeCents, championshipTopPct: l.championshipTopPct },
      rulesUrl: leagueRulesUrl(l),
      tutorialSteps: kioskTutorialSteps(l),
      me: me && me.active ? { playerId: me.id, name: me.displayName || `${member.firstName} ${member.lastName}`, isMinor: me.isMinor, winningsEligible: me.winningsEligible, handicap: myHc?.handicap ?? null, standing: myRow } : null,
      wouldBeMinor: isMinorFor(member.dob, l.minorAge),
      hasCard: member.paymentMethods.length > 0,
      card: member.paymentMethods[0] ?? null,
      currentWeek: cur ? { id: cur.id, weekNumber: cur.weekNumber, courseName: cur.courseName, deadlineAt: cur.deadlineAt.toISOString(), deadlineLabel: fmtDeadline(cur.deadlineAt, l.location.timezone), isOpen: cur.opensAt <= now && cur.deadlineAt >= now, potCents: cur.potCents, submittedCount: cur._count.scores, mySubmitted: !!me?.scores.find((s) => s.weekId === cur.id && s.status !== "REJECTED") } : null,
      leaders: standings.slice(0, 5),
      weeks: l.weeks.map((w) => ({ id: w.id, weekNumber: w.weekNumber, courseName: w.courseName, deadlineAt: w.deadlineAt.toISOString(), opensAt: w.opensAt.toISOString(), isChampionship: w.isChampionship, revealed: !!w.revealedAt, final: !!w.finalizedAt, potCents: w.potCents, submittedCount: w._count.scores, mySubmitted: !!me?.scores.find((s) => s.weekId === w.id && s.status !== "REJECTED"), myEntry: me?.entries.find((e) => e.weekId === w.id)?.status ?? null })),
    });
  }
  return { member: { id: member.id, firstName: member.firstName, lastName: member.lastName }, leagues: out };
}

/** Public hub for one league (web + app): standings, weeks with teams, settings. */
export async function leagueHub(leagueId: string, viewerMemberId?: string | null) {
  const prisma = getPrisma();
  const league = await loadLeague(leagueId);
  const [standings, weeks] = await Promise.all([leagueStandings(leagueId), leagueWeeks(leagueId)]);
  const me = viewerMemberId ? await prisma.leaguePlayer.findUnique({ where: { leagueId_memberId: { leagueId, memberId: viewerMemberId } } }) : null;
  return {
    league: {
      id: league.id,
      name: league.name,
      status: league.status,
      description: league.description,
      location: league.location,
      weeklyFeeCents: league.weeklyFeeCents,
      championshipAt: league.championshipAt?.toISOString() ?? null,
      championshipNote: league.championshipNote,
      championshipPotCents: league.championshipPotCents,
      championshipTopPct: league.championshipTopPct,
      settings: { gimmeDistanceFt: league.gimmeDistanceFt, mulligans: league.mulligans, greenSpeed: league.greenSpeed, teeRules: league.teeRules, openingWeeks: league.openingWeeks, handicapCap: league.handicapCap, throwOutEvery: league.throwOutEvery, pointsTop5: league.pointsTop5, pointsTop10: league.pointsTop10, pointsTop15: league.pointsTop15, pointsTeamWin: league.pointsTeamWin, pointsTeamTie: league.pointsTeamTie, firstPlacePct: league.firstPlacePct, firstPlaceCapCents: league.firstPlaceCapCents, secondPlacePct: league.secondPlacePct, secondPlaceCapCents: league.secondPlaceCapCents, minorAge: league.minorAge, weeklyFeeCents: league.weeklyFeeCents, championshipTopPct: league.championshipTopPct },
      rulesUrl: leagueRulesUrl(league),
      tutorialSteps: kioskTutorialSteps(league),
    },
    myPlayerId: me?.active ? me.id : null,
    standings,
    weeks,
    currentWeek: currentWeekOf(weeks.map((w) => ({ ...w, opensAt: new Date(w.opensAt), deadlineAt: new Date(w.deadlineAt) })))?.id ?? null,
  };
}

/** Admin detail: everything plus unrevealed scores, entries and OCR diagnostics. */
export async function adminLeagueDetail(leagueId: string) {
  const prisma = getPrisma();
  const league = await loadLeague(leagueId);
  const [hub, players, weeks] = await Promise.all([
    leagueHub(leagueId),
    prisma.leaguePlayer.findMany({ where: { leagueId }, include: { member: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, dob: true } }, _count: { select: { scores: true } } }, orderBy: { joinedAt: "asc" } }),
    prisma.leagueWeek.findMany({
      where: { leagueId },
      orderBy: { weekNumber: "asc" },
      include: {
        scores: { include: { player: { include: { member: { select: { firstName: true, lastName: true } } } } }, orderBy: { submittedAt: "asc" } },
        entries: { include: { player: { include: { member: { select: { firstName: true, lastName: true } } } } } },
        handicaps: true,
      },
    }),
  ]);
  return {
    ...hub,
    league: { ...hub.league, ...pickLeagueSettings(league) },
    players: players.map((p) => ({ id: p.id, memberId: p.memberId, name: playerName(p), displayName: p.displayName, aliases: p.aliases, member: p.member, isMinor: p.isMinor, winningsEligible: p.winningsEligible, active: p.active, joinedVia: p.joinedVia, joinedAt: p.joinedAt.toISOString(), notes: p.notes, scoreCount: p._count.scores })),
    adminWeeks: weeks.map((w) => ({
      id: w.id,
      weekNumber: w.weekNumber,
      scores: w.scores.map((s) => ({ id: s.id, playerId: s.playerId, name: playerName(s.player), holes: s.holes as number[], front9: s.front9, back9: s.back9, gross: s.gross, handicap: s.handicap, net: s.net, status: s.status, source: s.source, rejectReason: s.rejectReason, imageId: s.imageId, ocrSettings: s.ocrSettings, submittedAt: s.submittedAt.toISOString() })),
      entries: w.entries.map((e) => ({ id: e.id, playerId: e.playerId, name: playerName(e.player), feeCents: e.feeCents, status: e.status, source: e.source, failureReason: e.failureReason, invoiceId: e.invoiceId, paidAt: e.paidAt?.toISOString() ?? null })),
      handicaps: w.handicaps.map((h) => ({ playerId: h.playerId, handicap: h.handicap, strokesBack: h.strokesBack, roundsUsed: h.roundsUsed })),
    })),
  };
}

function pickLeagueSettings(l: LeagueRow) {
  return {
    status: l.status,
    minorAge: l.minorAge,
    weeklyFeeCents: l.weeklyFeeCents,
    firstPlacePct: l.firstPlacePct,
    firstPlaceCapCents: l.firstPlaceCapCents,
    secondPlacePct: l.secondPlacePct,
    secondPlaceCapCents: l.secondPlaceCapCents,
    openingWeeks: l.openingWeeks,
    handicapCap: l.handicapCap,
    throwOutEvery: l.throwOutEvery,
    pointsTop5: l.pointsTop5,
    pointsTop10: l.pointsTop10,
    pointsTop15: l.pointsTop15,
    pointsTeamWin: l.pointsTeamWin,
    pointsTeamTie: l.pointsTeamTie,
    championshipTopPct: l.championshipTopPct,
    gimmeDistanceFt: l.gimmeDistanceFt,
    mulligans: l.mulligans,
    greenSpeed: l.greenSpeed,
    teeRules: l.teeRules,
    rulesUrl: l.rulesUrl,
    championshipAt: l.championshipAt?.toISOString() ?? null,
    championshipNote: l.championshipNote,
    description: l.description,
  };
}
