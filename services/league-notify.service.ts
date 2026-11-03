// League v2 — public signup list + weekly notifications.
//
//   leagueSignup()              league.tee24.golf "Join the league" form. Members (matched by
//                               phone) are auto-joined to the running league; everyone is put on
//                               the weekly text list. Idempotent per phone.
//   leagueUnsubscribe()         one-click link in every text
//   runLeagueNotifications()    cron (with league-deadlines): "Week N is open" when a week opens,
//                               "Results are in" once a week is finalized. Players get push→SMS via
//                               deliverMemberMessage; non-member subscribers get SMS.
import { getPrisma } from "@/lib/db";
import { deliverMemberMessage, deliverSms } from "@/lib/notify";
import { findMemberByPhone } from "@/services/mobile-auth.service";
import { joinLeague, LeagueError, leagueScopeForLocations } from "@/services/league.service";

export const LEAGUE_SITE_URL = (process.env.LEAGUE_SITE_URL || "https://league.tee24.golf").replace(/\/$/, "");

const digits10 = (v: string) => v.replace(/\D/g, "").slice(-10);
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export type LeagueSignupInput = { firstName: string; lastName: string; phone: string; email?: string | null; notifyWeekly?: boolean; joinRequested?: boolean };

async function runningLeague() {
  return getPrisma().league.findFirst({ where: { status: { in: ["OPEN", "ACTIVE"] } }, orderBy: { createdAt: "desc" }, include: { weeks: { orderBy: { weekNumber: "asc" } } } });
}

export async function leagueSignup(input: LeagueSignupInput) {
  const prisma = getPrisma();
  const firstName = clean(input.firstName, 60);
  const lastName = clean(input.lastName, 60);
  const phone = digits10(String(input.phone ?? ""));
  const email = clean(input.email, 160).toLowerCase() || null;
  if (!firstName || !lastName) throw new LeagueError("First and last name are required", 400, "NAME_REQUIRED");
  if (phone.length !== 10) throw new LeagueError("Enter a 10-digit mobile number", 400, "PHONE_INVALID");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new LeagueError("That email doesn't look right", 400, "EMAIL_INVALID");

  const member = await findMemberByPhone(`+1${phone}`);
  const league = await runningLeague();
  const notifyWeekly = input.notifyWeekly !== false;
  const joinRequested = input.joinRequested !== false;

  let joined = false;
  let joinError: string | null = null;
  if (member && league && joinRequested) {
    try {
      await joinLeague({ leagueId: league.id, memberId: member.id, via: "APP" });
      joined = true;
    } catch (e) {
      joinError = e instanceof Error ? e.message : "Could not join";
    }
  }

  const sub = await prisma.leagueSubscriber.upsert({
    where: { phone },
    create: { phone, email, firstName, lastName, memberId: member?.id ?? null, organizationId: member?.organizationId ?? league?.organizationId ?? null, notifyWeekly, joinRequested, joinedLeagueId: joined ? league!.id : null, source: "WEB" },
    update: { email: email ?? undefined, firstName, lastName, memberId: member?.id ?? undefined, notifyWeekly, joinRequested, joinedLeagueId: joined ? league!.id : undefined, unsubscribedAt: notifyWeekly ? null : undefined },
  });

  // Confirmation text (transactional — the person just asked for this).
  const cur = league ? league.weeks.find((w) => w.opensAt <= new Date() && w.deadlineAt >= new Date()) ?? null : null;
  const lines = [
    `Tee24 League: you're on the list, ${firstName}.`,
    joined ? `You're in the league${cur ? ` — Week ${cur.weekNumber}${cur.courseName ? ` (${cur.courseName})` : ""} is open now. Submit at the bay by Sunday 11:59 PM.` : "."}` : member ? (league ? "" : "We'll text you when the season opens and add you then.") : "That number isn't on a Tee24 membership yet — join at the front desk or in the app and you'll be added automatically.",
    notifyWeekly ? `Weekly updates are on. ${LEAGUE_SITE_URL}  Stop: ${LEAGUE_SITE_URL}/unsubscribe?t=${sub.token}` : "",
  ].filter(Boolean);
  void deliverSms({ to: `+1${phone}`, text: lines.join(" "), category: "TRANSACTIONAL", organizationId: sub.organizationId }).catch((e) => console.error("[league] signup sms", e));

  return { ok: true, isMember: !!member, joined, joinError, leagueRunning: !!league, notifyWeekly, hasCard: member ? (await prisma.paymentMethod.count({ where: { memberId: member.id, status: { not: "EXPIRED" }, squareCardId: { not: null } } })) > 0 : null };
}

export async function leagueUnsubscribe(token: string) {
  const prisma = getPrisma();
  const sub = await prisma.leagueSubscriber.findUnique({ where: { token: String(token ?? "") } });
  if (!sub) throw new LeagueError("That link isn't valid", 404, "TOKEN_INVALID");
  await prisma.leagueSubscriber.update({ where: { id: sub.id }, data: { notifyWeekly: false, unsubscribedAt: new Date() } });
  return { ok: true, firstName: sub.firstName };
}

export async function listLeagueSubscribers(locationIds?: string[] | null) {
  const prisma = getPrisma();
  const scope = locationIds ? await leagueScopeForLocations(locationIds) : null;
  const orgIds = scope ? (await prisma.league.findMany({ where: scope, select: { organizationId: true } })).map((l) => l.organizationId).filter((x): x is string => !!x) : null;
  const rows = await prisma.leagueSubscriber.findMany({
    where: orgIds ? { OR: [{ organizationId: { in: orgIds } }, { organizationId: null }] } : {},
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}`.trim(), phone: r.phone, email: r.email, isMember: !!r.memberId, memberId: r.memberId, joined: !!r.joinedLeagueId, notifyWeekly: r.notifyWeekly && !r.unsubscribedAt, createdAt: r.createdAt.toISOString() }));
}

/* ───────────────────────────── weekly texts ───────────────────────────── */

type Recipient = { memberId: string | null; phone: string; organizationId: string | null; locationId: string | null; timeZone: string | null };

async function recipientsFor(leagueId: string): Promise<Recipient[]> {
  const prisma = getPrisma();
  const league = await prisma.league.findUnique({ where: { id: leagueId }, include: { location: { select: { id: true, timezone: true } } } });
  if (!league) return [];
  const players = await prisma.leaguePlayer.findMany({ where: { leagueId, active: true }, include: { member: { select: { id: true, phone: true } } } });
  const subs = await prisma.leagueSubscriber.findMany({ where: { notifyWeekly: true, unsubscribedAt: null, OR: [{ organizationId: league.organizationId }, { organizationId: null }] } });
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const p of players) {
    const key = p.member.phone ? digits10(p.member.phone) : `m:${p.memberId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ memberId: p.memberId, phone: p.member.phone ? `+1${digits10(p.member.phone)}` : "", organizationId: league.organizationId, locationId: league.locationId, timeZone: league.location.timezone });
  }
  for (const s of subs) {
    if (seen.has(s.phone)) continue;
    seen.add(s.phone);
    out.push({ memberId: s.memberId, phone: `+1${s.phone}`, organizationId: league.organizationId, locationId: league.locationId, timeZone: league.location.timezone });
  }
  return out;
}

async function broadcast(leagueId: string, title: string, text: string, data: Record<string, unknown>) {
  const rs = await recipientsFor(leagueId);
  let sent = 0;
  for (const r of rs) {
    try {
      if (r.memberId) {
        const res = await deliverMemberMessage({ memberId: r.memberId, phone: r.phone || null, title, text, data, category: "TRANSACTIONAL", organizationId: r.organizationId, locationId: r.locationId, timeZone: r.timeZone });
        if (res.ok) sent++;
      } else if (r.phone) {
        const res = await deliverSms({ to: r.phone, text, category: "TRANSACTIONAL", organizationId: r.organizationId, timeZone: r.timeZone });
        if (res.ok) sent++;
      }
    } catch (e) {
      console.error("[league] notify failed", r.phone, e);
    }
  }
  return { recipients: rs.length, sent };
}

const fmtDeadline = (d: Date, tz: string) => d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });

/** Send "week open" and "results in" messages that haven't gone out yet. Safe to run every cron tick. */
export async function runLeagueNotifications(now = new Date()) {
  const prisma = getPrisma();
  const leagues = await prisma.league.findMany({ where: { status: { in: ["OPEN", "ACTIVE"] } }, include: { location: { select: { timezone: true } }, weeks: { orderBy: { weekNumber: "asc" } } } });
  const out: { weekId: string; kind: "OPEN" | "RESULTS"; recipients: number; sent: number }[] = [];
  let autoJoined = 0;
  for (const l of leagues) {
    const tz = l.location.timezone;
    // Members who signed up on the website before this league existed asked to be added
    // "when the season opens" — do that now, before the week-open text goes out.
    const pending = await prisma.leagueSubscriber.findMany({
      where: { memberId: { not: null }, joinRequested: true, joinedLeagueId: null, OR: [{ organizationId: l.organizationId }, { organizationId: null }] },
    });
    for (const s of pending) {
      try {
        await joinLeague({ leagueId: l.id, memberId: s.memberId!, via: "APP" });
        await prisma.leagueSubscriber.update({ where: { id: s.id }, data: { joinedLeagueId: l.id } });
        autoJoined++;
      } catch (e) {
        console.error("[league] auto-join failed", s.phone, e instanceof Error ? e.message : e);
      }
    }
    for (const w of l.weeks) {
      // Week just opened (and is still open): announce the course + deadline.
      if (!w.openNotifiedAt && w.opensAt <= now && w.deadlineAt > now) {
        // Claim first so overlapping cron runs don't double-send.
        const claimed = await prisma.leagueWeek.updateMany({ where: { id: w.id, openNotifiedAt: null }, data: { openNotifiedAt: now } });
        if (claimed.count === 0) continue;
        const label = w.isChampionship ? "Championship week" : `Week ${w.weekNumber}`;
        const text = `Tee24 League — ${label} is open${w.courseName ? `: ${w.courseName}` : ""}. Play 18 and submit at the bay kiosk by ${fmtDeadline(w.deadlineAt, tz)}. ${LEAGUE_SITE_URL}/weeks`;
        const r = await broadcast(l.id, `${label} is open`, text, { screen: "league", leagueId: l.id, weekId: w.id });
        out.push({ weekId: w.id, kind: "OPEN", ...r });
      }
      // Week finalized: results + next week's teams are up.
      if (w.finalizedAt && !w.resultsNotifiedAt) {
        const claimed = await prisma.leagueWeek.updateMany({ where: { id: w.id, resultsNotifiedAt: null }, data: { resultsNotifiedAt: now } });
        if (claimed.count === 0) continue;
        const label = w.isChampionship ? "Championship" : `Week ${w.weekNumber}`;
        const next = l.weeks.find((x) => x.weekNumber === w.weekNumber + 1);
        const text = `Tee24 League — ${label} results are in${next ? ` and Week ${next.weekNumber} teams are drawn${next.courseName ? ` (${next.courseName})` : ""}` : ""}. ${LEAGUE_SITE_URL}/weeks?week=${w.id}`;
        const r = await broadcast(l.id, `${label} results are in`, text, { screen: "league", leagueId: l.id, weekId: w.id });
        out.push({ weekId: w.id, kind: "RESULTS", ...r });
      }
    }
  }
  return { notifications: out, autoJoined };
}
