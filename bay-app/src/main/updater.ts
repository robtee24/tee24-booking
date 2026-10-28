import { app } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import log from 'electron-log';

export type UpdatePhase =
  | { phase: 'checking' }
  | { phase: 'none'; version: string }
  | { phase: 'downloading'; version: string; percent: number }
  /** Downloaded, but a session is in progress; installs when the bay is free. */
  | { phase: 'ready'; version: string }
  | { phase: 'installing'; version: string }
  | { phase: 'error'; message: string };

type Listener = (p: UpdatePhase) => void;
type Result = 'updated' | 'current' | 'ready' | 'skipped';

/**
 * Keeping the kiosk on the latest release.
 *
 *  1. Every launch (so every PC restart) blocks on a check: checking →
 *     (none | downloading → installing → quitAndInstall). The splash shows
 *     progress; the kiosk never reaches the home screen on an outdated build
 *     unless the update server is unreachable.
 *  2. If that check could not complete (bay PC booted before the network was
 *     up), it is retried every couple of minutes until one succeeds.
 *  3. After that, a periodic check picks up releases shipped during the day.
 *     A download found while someone is playing is held ('ready') and
 *     installed the next time the bay is free (idle close, or the periodic
 *     check seeing no session).
 *
 * The install itself must never need a UAC click: the app is a per-user NSIS
 * install (electron-builder.yml `perMachine: false`), so the updater runs the
 * installer without elevation. A per-machine build would stall at a UAC
 * prompt nobody is there to approve.
 */

const RETRY_WHEN_OFFLINE_MS = 2 * 60 * 1000;
const PERIODIC_MS = 6 * 60 * 60 * 1000;

let inFlight: Promise<Result> | null = null;
let pending: UpdateInfo | null = null;
let lastCheckOk = 0;

function configure() {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
}

function install(onPhase: Listener, info: UpdateInfo) {
  pending = null;
  onPhase({ phase: 'installing', version: info.version });
  setTimeout(() => {
    // isSilent=true, isForceRunAfter=true → installs quietly and relaunches.
    autoUpdater.quitAndInstall(true, true);
  }, 800);
}

/**
 * One check. `installNow()` is consulted once the download finishes: true →
 * install and relaunch immediately; false → hold it as pending.
 */
function check(onPhase: Listener, { timeoutMs, installNow }: { timeoutMs: number; installNow: () => boolean }): Promise<Result> {
  if (!app.isPackaged) {
    onPhase({ phase: 'none', version: app.getVersion() });
    return Promise.resolve('skipped');
  }
  if (inFlight) return inFlight;
  if (pending) {
    // Already downloaded earlier; nothing to fetch, just (maybe) install.
    if (installNow()) {
      install(onPhase, pending);
      return Promise.resolve('updated');
    }
    onPhase({ phase: 'ready', version: pending.version });
    return Promise.resolve('ready');
  }
  configure();

  inFlight = new Promise<Result>((resolve) => {
    let settled = false;
    const finish = (r: Result) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      autoUpdater.removeAllListeners();
      inFlight = null;
      resolve(r);
    };

    // Never hang startup on a slow/offline network.
    const watchdog = setTimeout(() => {
      log.warn('[updater] timed out; continuing with current version');
      onPhase({ phase: 'none', version: app.getVersion() });
      finish('skipped');
    }, timeoutMs);

    autoUpdater.on('checking-for-update', () => onPhase({ phase: 'checking' }));
    autoUpdater.on('update-not-available', () => {
      lastCheckOk = Date.now();
      onPhase({ phase: 'none', version: app.getVersion() });
      finish('current');
    });
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      log.info(`[updater] update available ${info.version}`);
      lastCheckOk = Date.now();
      // Downloading: stop the watchdog, give the download as long as it needs.
      clearTimeout(watchdog);
      onPhase({ phase: 'downloading', version: info.version, percent: 0 });
    });
    autoUpdater.on('download-progress', (p) => {
      onPhase({ phase: 'downloading', version: '', percent: Math.round(p.percent) });
    });
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      if (installNow()) {
        log.info(`[updater] downloaded ${info.version}; installing`);
        settled = true;
        inFlight = null;
        install(onPhase, info);
        resolve('updated');
        return;
      }
      log.info(`[updater] downloaded ${info.version}; a session is in progress, installing when the bay is free`);
      pending = info;
      onPhase({ phase: 'ready', version: info.version });
      finish('ready');
    });
    autoUpdater.on('error', (err) => {
      log.error('[updater] error', err);
      onPhase({ phase: 'error', message: err?.message ?? String(err) });
      finish('skipped');
    });

    autoUpdater.checkForUpdates().catch((err) => {
      log.error('[updater] checkForUpdates failed', err);
      onPhase({ phase: 'error', message: err?.message ?? String(err) });
      finish('skipped');
    });
  });
  return inFlight;
}

/** Blocking check on every launch; installs straight away (nobody is mid-session at boot). */
export function runStartupUpdate(onPhase: Listener, { timeoutMs = 45_000 } = {}): Promise<Result> {
  return check(onPhase, { timeoutMs, installNow: () => true });
}

/** Manual check from the Settings screen (an admin is standing there, so install at once). */
export function checkForUpdatesNow(onPhase: Listener) {
  return check(onPhase, { timeoutMs: 30_000, installNow: () => true });
}

/**
 * Keep checking after boot. `bayIsFree()` says whether installing right now
 * would interrupt anyone (false while GSPro is up or one of our modals is
 * showing). Returns a stop function.
 */
export function startBackgroundUpdates(onPhase: Listener, bayIsFree: () => boolean, startupResult: Result) {
  if (!app.isPackaged) return () => {};
  let timer: NodeJS.Timeout | null = null;

  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, ms);
  };
  const tick = async () => {
    const r = await check(onPhase, { timeoutMs: 45_000, installNow: bayIsFree });
    if (r === 'updated') return; // relaunching
    if (r === 'skipped') {
      log.info('[updater] check did not complete; retrying in 2 min');
      schedule(RETRY_WHEN_OFFLINE_MS);
      return;
    }
    schedule(PERIODIC_MS);
  };

  if (startupResult === 'skipped') schedule(RETRY_WHEN_OFFLINE_MS);
  else schedule(PERIODIC_MS);

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

/**
 * The bay just went idle (session closed, nobody there). Install a held
 * update now; otherwise, if the last good check is stale, check again.
 */
export function onBayIdle(onPhase: Listener, bayIsFree: () => boolean) {
  if (!app.isPackaged) return;
  if (pending) {
    if (bayIsFree()) {
      log.info(`[updater] bay is idle; installing held update ${pending.version}`);
      install(onPhase, pending);
    }
    return;
  }
  if (Date.now() - lastCheckOk > 60 * 60 * 1000) {
    void check(onPhase, { timeoutMs: 45_000, installNow: bayIsFree });
  }
}

export function hasPendingUpdate() {
  return pending != null;
}
