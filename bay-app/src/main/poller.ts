import { app, powerMonitor } from 'electron';
import { execFile } from 'child_process';
import log from 'electron-log';
import { getStatus, cancelTimeout, type StatusResponse, type Booking } from './api';
import { getSettings, isRegistered, updateSettings, type KioskSettings } from './store';
import { getLauncherState, onLauncherChange, closeSession, restartSession, type LauncherState } from './launcher';
import { rememberRemoteInfo } from './remote';
import * as windows from './windows';
import * as screenWatch from './screen';
import * as players from './players';

/**
 * Kiosk state machine.
 *
 * Reservation behaviour is driven entirely by the server (`/api/bay-app/status`),
 * and is completely inert unless the location has `bayAppEnabled` turned on in
 * the admin console. Countdowns use server time (serverNow offset) so a wrong
 * PC clock can never fire the wrong modal.
 *
 *  - currentBooking, not checked in  → "unlock" modal (phone entry) until
 *    start + unlockMinutes; then dismissed (and the server is asked to apply
 *    its opt-in auto-cancel rule).
 *  - nextBooking within warning window → "upcoming" modal until accepted;
 *    after accept the toolbar shows a countdown to the start time.
 *  - help / schedule modes are user-initiated from the toolbar or home screen.
 */

export type OverlayMode = 'none' | 'unlock' | 'upcoming' | 'help' | 'schedule' | 'export' | 'idle' | 'players' | 'restart';

export interface KioskState {
  version: string;
  registered: boolean;
  online: boolean;
  lastError: string | null;
  lastPollAt: string | null;
  serverOffsetMs: number;
  status: StatusResponse | null;
  overlay: { mode: OverlayMode; booking: Booking | null; deadline: string | null };
  /** Countdown shown in the toolbar (ISO server time) */
  countdown: { label: string; until: string } | null;
  launcher: LauncherState;
  settings: KioskSettings;
  /** What GSPro is showing right now (OCR of the display while a session runs) */
  screen: screenWatch.GsproScreen;
  /** Too-many-players enforcement */
  players: players.PlayersState;
}

const POLL_IDLE_MS = 15_000;
const POLL_ACTIVE_MS = 5_000;

let state: KioskState = {
  version: app.getVersion(),
  registered: isRegistered(),
  online: false,
  lastError: null,
  lastPollAt: null,
  serverOffsetMs: 0,
  status: null,
  overlay: { mode: 'none', booking: null, deadline: null },
  countdown: null,
  launcher: getLauncherState(),
  settings: getSettings(),
  screen: screenWatch.getScreen(),
  players: players.getPlayersState(null),
};

const acceptedUpcoming = new Set<string>();
const dismissedUnlock = new Set<string>();
const cancelRequested = new Set<string>();
type UserMode = Exclude<OverlayMode, 'unlock' | 'upcoming' | 'idle' | 'players' | 'restart'>;
let userMode: UserMode = 'none';

// ---------- Idle timeout ----------
//
// GSPro has no API that tells us whether anyone is playing, so "activity" is
// system-wide mouse/keyboard input (powerMonitor.getSystemIdleTime). Players
// mid-round may not touch the PC for a while, so a countdown modal appears
// before anything closes; any tap or click resets the idle clock and clears it.

/** Seconds of warning before the close; shorter limits get a shorter warning. */
function idleWarnSeconds(limitSec: number) {
  return Math.min(60, Math.max(10, Math.floor(limitSec / 2)));
}
let idleClosing = false;

/** Returns an 'idle' overlay if the session is about to be closed for inactivity, else null. */
function evaluateIdle(): KioskState['overlay'] | null {
  const { idleCloseMinutes } = getSettings();
  const launcher = getLauncherState();
  if (!launcher.running || !launcher.gsproPid) {
    // Session is over (or never started); arm the idle close for the next one.
    idleClosing = false;
    return null;
  }
  if (!idleCloseMinutes || idleCloseMinutes <= 0 || idleClosing) return null;

  const limit = idleCloseMinutes * 60;
  const idle = powerMonitor.getSystemIdleTime();
  if (idle >= limit) {
    // Stays set until the watcher reports the session gone, so a slow force-kill
    // doesn't trigger a second close.
    idleClosing = true;
    log.info(`[idle] no input for ${idle}s (limit ${limit}s); closing the session`);
    void closeSession(`idle ${idleCloseMinutes} min`).then(() => afterIdleClose());
    return null;
  }
  const warn = idleWarnSeconds(limit);
  if (idle >= limit - warn) {
    const deadline = new Date(Math.round((Date.now() + (limit - idle) * 1000) / 1000) * 1000).toISOString();
    return { mode: 'idle', booking: null, deadline };
  }
  return null;
}

// ---------- Maintenance restart ----------

const RESTART_COUNTDOWN_S = 30;
let restartAt: string | null = null;

/**
 * Every Nth inactivity close restarts Windows (GSPro, IDRA and the GolfIn
 * launcher all leak over a day of sessions). Idle means nobody is at the bay,
 * so this is the least disruptive moment. The kiosk comes back through its
 * logon task, which needs Windows auto sign-in on the bay PC.
 */
function afterIdleClose() {
  const s = getSettings();
  const count = (s.idleCloseCount ?? 0) + 1;
  const every = s.restartEveryIdleCloses ?? 0;
  if (every > 0 && count >= every) {
    updateSettings({ idleCloseCount: 0 });
    scheduleRestart(`${count} inactivity closes`);
  } else {
    updateSettings({ idleCloseCount: count });
    log.info(`[idle] close ${count}${every > 0 ? ` of ${every} before a maintenance restart` : ''}`);
    // Nobody is at the bay: a good moment to apply a held update (the restart
    // branch skips this, the fresh boot runs its own check).
    idleCloseHook?.();
  }
  publish();
}

let idleCloseHook: (() => void) | null = null;
/** Called after an inactivity close that did not schedule a restart. */
export function setIdleCloseHook(fn: (() => void) | null) {
  idleCloseHook = fn;
}

function scheduleRestart(reason: string) {
  if (restartAt) return;
  restartAt = new Date(Date.now() + RESTART_COUNTDOWN_S * 1000).toISOString();
  log.warn(`[restart] restarting Windows in ${RESTART_COUNTDOWN_S}s (${reason})`);
  // Hand the restart to Windows now so it happens even if the kiosk dies first.
  execFile('shutdown.exe', ['/r', '/f', '/t', String(RESTART_COUNTDOWN_S), '/c', 'Tee24 bay maintenance restart'], { windowsHide: true }, (err) => {
    if (err) {
      log.error('[restart] shutdown.exe failed', err.message);
      restartAt = null;
      publish();
    }
  });
  evaluate();
  publish();
}

/** Staff pressed "Cancel" on the restart notice. */
export function cancelRestart() {
  if (!restartAt) return;
  execFile('shutdown.exe', ['/a'], { windowsHide: true }, () => {});
  log.info('[restart] cancelled by staff');
  restartAt = null;
  evaluate();
  publish();
}

let pollTimer: NodeJS.Timeout | null = null;
let tickTimer: NodeJS.Timeout | null = null;
let polling = false;

export function serverNow(): number {
  return Date.now() + state.serverOffsetMs;
}

export function getState(): KioskState {
  return state;
}

function publish() {
  state = { ...state, registered: isRegistered(), settings: getSettings(), launcher: getLauncherState(), screen: screenWatch.getScreen() };
  windows.broadcast('kiosk:state', state);
  applyWindows();
}

function applyWindows() {
  const { overlay, launcher } = state;
  if (overlay.mode !== 'none') windows.showOverlay();
  else windows.hideOverlay();

  // Read GSPro's screen only while it is actually up. Scans pause while one of
  // our own modals covers the screen (we would OCR ourselves).
  if (launcher.running && !!launcher.gsproPid) {
    screenWatch.startWatching(
      () => state.overlay.mode !== 'none',
      // Relax mid-round when the player count is fine (or not enforced).
      () => !state.players.alert && !state.players.done,
    );
  } else {
    screenWatch.stopWatching();
    players.resetForSession();
  }

  // Floating Help/Schedule strip only while GSPro is running (home has its own buttons).
  // Wait for a real GSPro process (gsproPid) before stepping aside, otherwise the
  // Windows desktop shows for the seconds between Play and GSPro's first window.
  const inSession = launcher.running && !!launcher.gsproPid && !homeForced;
  if (inSession) {
    // Home stays visible *under* GSPro (see windows.parkHomeBehind), so GSPro
    // closing reveals the kiosk, never the desktop.
    windows.parkHomeBehind(!wasInSession);
    windows.showToolbar();
  } else {
    windows.hideToolbar();
    windows.showHome();
  }
  wasInSession = inSession;
}
let wasInSession = false;

/** Staff shortcut (Ctrl+Shift+T) brings the home screen over GSPro; Play parks it again. */
let homeForced = false;
export function setHomeForced(v: boolean) {
  homeForced = v;
  publish();
}

export function start() {
  onLauncherChange(() => publish());
  screenWatch.onScreenChange(() => {
    evaluate();
    publish();
  });
  if (!tickTimer) tickTimer = setInterval(evaluate, 1000);
  schedulePoll(0);
}

export function stop() {
  if (pollTimer) clearTimeout(pollTimer);
  if (tickTimer) clearInterval(tickTimer);
  pollTimer = tickTimer = null;
}

function schedulePoll(ms: number) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(pollNow, ms);
}

export async function pollNow() {
  if (polling) return;
  polling = true;
  try {
    if (!isRegistered()) {
      state = { ...state, status: null, overlay: { mode: userMode, booking: null, deadline: null }, countdown: null };
      publish();
      return;
    }
    const s = getSettings();
    const res = await getStatus({ nodeId: s.remoteNodeId });
    const offset = new Date(res.serverNow).getTime() - Date.now();
    rememberRemoteInfo(res.remote);

    // Keep the local copy of bay details fresh (admin may rename the bay from the web).
    const patch: Partial<KioskSettings> = {};
    if (res.bay.id && res.bay.id !== s.bayId) patch.bayId = res.bay.id;
    if (res.bay.name !== s.bayName) patch.bayName = res.bay.name;
    if (res.bay.launchMonitor !== s.launchMonitor) patch.launchMonitor = res.bay.launchMonitor;
    if (res.location.name !== s.locationName) patch.locationName = res.location.name;
    if (res.location.slug !== s.locationSlug) patch.locationSlug = res.location.slug;
    if (Object.keys(patch).length) updateSettings(patch);

    const cameOnline = !state.online || !!state.lastError;
    state = { ...state, online: true, lastError: null, lastPollAt: new Date().toISOString(), serverOffsetMs: offset, status: res };
    evaluate();
    // evaluate() only publishes when the overlay/countdown changed; on a quiet bay
    // the first successful poll changes neither, which left "Offline" on screen.
    if (cameOnline) publish();
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 404) {
      // Registration was removed server-side (admin reassigned the bay). Fall back to setup.
      log.warn('[poller] device no longer registered');
      updateSettings({ locationId: null, bayNumber: null, bayId: null, setupCompletedAt: null });
      state = { ...state, status: null, overlay: { mode: 'none', booking: null, deadline: null }, countdown: null, lastError: 'This computer is no longer assigned to a bay.' };
      publish();
    } else {
      state = { ...state, online: false, lastError: err.message ?? 'Network error' };
      publish();
    }
  } finally {
    polling = false;
    const active = state.overlay.mode === 'unlock' || state.overlay.mode === 'upcoming';
    schedulePoll(active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
  }
}

/** Re-derive overlay + countdown from status and server time. Runs every second. */
function evaluate() {
  const st = state.status;
  let overlay: KioskState['overlay'] = { mode: userMode, booking: null, deadline: null };
  let countdown: KioskState['countdown'] = null;

  if (st && st.location.bayAppEnabled && !st.bay.disabled) {
    const now = serverNow();
    const cur = st.currentBooking;
    const next = st.nextBooking;

    if (cur && !cur.checkedInAt) {
      const deadline = new Date(cur.start).getTime() + st.location.bayAppUnlockMinutes * 60_000;
      if (now >= deadline) {
        if (!dismissedUnlock.has(cur.id)) {
          dismissedUnlock.add(cur.id);
          log.info(`[poller] unlock window passed for ${cur.id}`);
        }
        if (!cancelRequested.has(cur.id)) {
          cancelRequested.add(cur.id);
          // Server enforces every rule (opt-in flag, timing, device match). This is a request, not a command.
          cancelTimeout(cur.id)
            .then((r) => log.info(`[poller] cancel-timeout ${cur.id} → ${JSON.stringify(r)}`))
            .catch((err) => log.warn('[poller] cancel-timeout failed', err?.message));
        }
      } else if (!dismissedUnlock.has(cur.id)) {
        overlay = { mode: 'unlock', booking: cur, deadline: new Date(deadline).toISOString() };
        countdown = { label: 'Unlock by', until: new Date(deadline).toISOString() };
      }
    } else if (cur && cur.checkedInAt) {
      countdown = { label: 'Session ends', until: cur.end };
      // Keep the "You're all set" confirmation on screen briefly after check-in.
      if (celebrate && celebrate.bookingId === cur.id && Date.now() < celebrate.until) {
        overlay = { mode: 'unlock', booking: cur, deadline: cur.end };
      }
    }

    if (overlay.mode !== 'unlock' && next) {
      if (!acceptedUpcoming.has(next.id)) {
        overlay = { mode: 'upcoming', booking: next, deadline: next.start };
      }
      if (!countdown) countdown = { label: `${next.firstName} ${next.lastInitial}. starts in`, until: next.start };
    }
  }

  // Too many players in GSPro for this booking: blocks until resolved. Sits
  // above help/schedule/export but below the unlock modal (no booking yet).
  const alert = overlay.mode === 'unlock' ? null : players.evaluatePlayers(st?.currentBooking ?? null, screenWatch.getScreen());
  const playersState = players.getPlayersState(alert);
  if (alert || (playersState.done && overlay.mode !== 'unlock')) overlay = { mode: 'players', booking: st?.currentBooking ?? null, deadline: null };

  // Inactivity warning wins over everything: it is the last thing the player
  // can still react to before GSPro is closed.
  const idle = evaluateIdle();
  if (idle) overlay = idle;

  // Maintenance restart countdown beats everything (the PC is going down).
  if (restartAt) overlay = { mode: 'restart', booking: null, deadline: restartAt };

  const changed =
    overlay.mode !== state.overlay.mode ||
    overlay.booking?.id !== state.overlay.booking?.id ||
    overlay.deadline !== state.overlay.deadline ||
    countdown?.until !== state.countdown?.until ||
    countdown?.label !== state.countdown?.label ||
    JSON.stringify(playersState) !== JSON.stringify(state.players);

  if (changed || !state.lastPollAt) {
    state = { ...state, overlay, countdown, players: playersState };
    publish();
  }
}

// ---------- Too-many-players actions ----------

export async function playersProceed() {
  const alert = state.players.alert;
  if (!alert) throw new Error('Nothing to acknowledge');
  const r = await players.proceed(alert);
  evaluate();
  publish();
  return r;
}

export async function playersAddMember(phone: string) {
  const bookingId = state.players.alert?.bookingId ?? state.status?.currentBooking?.id;
  if (!bookingId) throw new Error('No reservation on this bay');
  const r = await players.addMember(bookingId, phone);
  evaluate();
  publish();
  schedulePoll(500); // pick up the server-side allowance too
  return r;
}

export function playersSnooze() {
  players.snooze();
  evaluate();
  publish();
}

export function playersDismiss() {
  players.dismissDone();
  evaluate();
  publish();
}

export async function playersExitGame() {
  const alert = state.players.alert;
  players.snooze(90_000);
  evaluate();
  publish();
  // Tell the admin console (timestamped) even though nothing is charged.
  if (alert) void players.reportExit(alert);
  setHomeForced(false);
  await restartSession('too many players; player chose to exit');
  forcePublish();
}

// ---------- Actions from renderer ----------

export function acceptUpcoming(bookingId: string) {
  acceptedUpcoming.add(bookingId);
  evaluate();
  publish();
}

export function dismissUnlock(bookingId: string) {
  // Staff-only escape hatch (not exposed to players); the server still owns cancellation.
  dismissedUnlock.add(bookingId);
  evaluate();
  publish();
}

export function setUserMode(mode: UserMode) {
  userMode = mode;
  evaluate();
  publish();
}

let celebrate: { bookingId: string; until: number } | null = null;

export function afterCheckIn() {
  // Optimistically reflect the check-in until the next poll confirms.
  if (state.status?.currentBooking) {
    celebrate = { bookingId: state.status.currentBooking.id, until: Date.now() + 5000 };
    state = {
      ...state,
      status: { ...state.status, currentBooking: { ...state.status.currentBooking, checkedInAt: new Date().toISOString() } },
    };
  }
  evaluate();
  publish();
  schedulePoll(1000);
}

export function forcePublish() {
  publish();
}
