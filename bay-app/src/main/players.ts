import log from 'electron-log';
import { addCompanionMember, createGuestViolation, type Booking, type PlayerAllowance } from './api';
import type { GsproScreen } from './screen';

/**
 * Too-many-players enforcement.
 *
 * The server tells us how many people the current booking allows on the bay
 * (member + their guest allowance + any other members who identified
 * themselves at the kiosk). The screen watcher tells us how many players
 * GSPro shows. When players > allowed we raise an alert the overlay renders as
 * a blocking modal; the player can
 *   - fix it (remove a player / exit the game — exiting is reported to the
 *     admin console with a timestamp, nothing is charged),
 *   - identify other members by phone (raises the allowance), or
 *   - acknowledge the per-guest charge and proceed, which records a violation
 *     the admin console shows as an alert.
 */

export interface PlayersAlert {
  screen: 'SETUP' | 'ROUND';
  playerCount: number;
  allowedPlayers: number;
  extraGuests: number;
  feeCents: number;
  bookingId: string;
}

export interface PlayersState {
  alert: PlayersAlert | null;
  /** Last allowance returned by the server after "Other players are members" (for the modal) */
  allowance: PlayerAllowance | null;
  /** Just acknowledged: the modal shows a short "you're good to go" until dismissed */
  done: PlayersAlert | null;
}

const SNOOZE_MS = 30_000;
const DONE_VISIBLE_MS = 15_000;

let snoozedUntil = 0;
/** bookingId → highest player count already acknowledged (charged) */
const acknowledged = new Map<string, number>();
/** bookingId → allowance learned from add-member before the next status poll */
const localAllowed = new Map<string, number>();
let lastAllowance: PlayerAllowance | null = null;
let done: { alert: PlayersAlert; until: number } | null = null;

export function getPlayersState(alert: PlayersAlert | null): PlayersState {
  if (done && Date.now() > done.until) done = null;
  return { alert, allowance: lastAllowance, done: done?.alert ?? null };
}

export function dismissDone() {
  done = null;
}

export function evaluatePlayers(booking: Booking | null, screen: GsproScreen): PlayersAlert | null {
  if (!booking || !booking.players) return null;
  const serverAllowed = booking.players.allowedPlayers;
  if (serverAllowed == null) return null; // not enforced for this booking
  const allowed = Math.max(serverAllowed, localAllowed.get(booking.id) ?? 0);
  if (screen.kind !== 'setup' && screen.kind !== 'round') return null;
  if (screen.playerCount == null || screen.playerCount <= allowed) return null;
  if (Date.now() < snoozedUntil) return null;
  if ((acknowledged.get(booking.id) ?? 0) >= screen.playerCount) return null;

  const extraGuests = screen.playerCount - allowed;
  return {
    screen: screen.kind === 'setup' ? 'SETUP' : 'ROUND',
    playerCount: screen.playerCount,
    allowedPlayers: allowed,
    extraGuests,
    feeCents: extraGuests * booking.players.unauthorizedGuestFeeCents,
    bookingId: booking.id,
  };
}

/** Player ticked the box and pressed Proceed / Continue: charge + admin alert. */
export async function proceed(alert: PlayersAlert) {
  const v = await createGuestViolation({
    bookingId: alert.bookingId,
    screen: alert.screen,
    action: 'PROCEEDED',
    playerCount: alert.playerCount,
    allowedPlayers: alert.allowedPlayers,
  });
  acknowledged.set(alert.bookingId, Math.max(acknowledged.get(alert.bookingId) ?? 0, alert.playerCount));
  log.warn(`[players] violation ${v.id}: ${alert.playerCount} players / ${alert.allowedPlayers} allowed (${alert.screen}), $${v.feeCents / 100}`);
  done = { alert, until: Date.now() + DONE_VISIBLE_MS };
  return v;
}

/** Player chose "Exit the game": no charge, but the admin console gets a timestamped alert. */
export async function reportExit(alert: PlayersAlert) {
  try {
    const v = await createGuestViolation({
      bookingId: alert.bookingId,
      screen: alert.screen,
      action: 'EXITED',
      playerCount: alert.playerCount,
      allowedPlayers: alert.allowedPlayers,
    });
    log.info(`[players] exit reported (${v.id}): ${alert.playerCount} players / ${alert.allowedPlayers} allowed (${alert.screen})`);
  } catch (e) {
    log.warn('[players] could not report exit', (e as Error).message);
  }
}

/** "Other players are members": add one by phone; returns the new allowance. */
export async function addMember(bookingId: string, phone: string) {
  const a = await addCompanionMember(bookingId, phone);
  lastAllowance = a;
  if (a.allowedPlayers != null) localAllowed.set(bookingId, a.allowedPlayers);
  log.info(`[players] companion added (${a.added?.firstName ?? '?'}); allowed now ${a.allowedPlayers}`);
  return a;
}

/** "Remove a player" / exiting: hide the modal briefly so they can act in GSPro. */
export function snooze(ms = SNOOZE_MS) {
  snoozedUntil = Date.now() + ms;
}

export function resetForSession() {
  snoozedUntil = 0;
  lastAllowance = null;
  done = null;
}
