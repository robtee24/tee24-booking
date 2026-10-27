import { app } from 'electron';
import log from 'electron-log';
import { getStatus, cancelTimeout, type StatusResponse, type Booking } from './api';
import { getSettings, isRegistered, updateSettings, type KioskSettings } from './store';
import { getLauncherState, onLauncherChange, type LauncherState } from './launcher';
import { rememberRemoteInfo } from './remote';
import * as windows from './windows';

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

export type OverlayMode = 'none' | 'unlock' | 'upcoming' | 'help' | 'schedule' | 'export';

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
};

const acceptedUpcoming = new Set<string>();
const dismissedUnlock = new Set<string>();
const cancelRequested = new Set<string>();
let userMode: Exclude<OverlayMode, 'unlock' | 'upcoming'> = 'none';

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
  state = { ...state, registered: isRegistered(), settings: getSettings(), launcher: getLauncherState() };
  windows.broadcast('kiosk:state', state);
  applyWindows();
}

function applyWindows() {
  const { overlay, launcher } = state;
  if (overlay.mode !== 'none') windows.showOverlay();
  else windows.hideOverlay();

  // Floating Help/Schedule strip only while GSPro is running (home has its own buttons).
  // Wait for a real GSPro process (gsproPid) before hiding home, otherwise the
  // Windows desktop shows for the seconds between Play and GSPro's first window.
  if (launcher.running && launcher.gsproPid && !homeForced) {
    windows.hideHome();
    windows.showToolbar();
  } else {
    windows.hideToolbar();
    windows.showHome();
  }
}

/** Staff shortcut (Ctrl+Shift+T) brings the home screen over GSPro; Play hides it again. */
let homeForced = false;
export function setHomeForced(v: boolean) {
  homeForced = v;
  publish();
}

export function start() {
  onLauncherChange(() => publish());
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

  const changed =
    overlay.mode !== state.overlay.mode ||
    overlay.booking?.id !== state.overlay.booking?.id ||
    overlay.deadline !== state.overlay.deadline ||
    countdown?.until !== state.countdown?.until ||
    countdown?.label !== state.countdown?.label;

  if (changed || !state.lastPollAt) {
    state = { ...state, overlay, countdown };
    publish();
  }
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

export function setUserMode(mode: Exclude<OverlayMode, 'unlock' | 'upcoming'>) {
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
