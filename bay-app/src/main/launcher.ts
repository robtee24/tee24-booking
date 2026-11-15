import { spawn, execFile, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { getSettings, launchMonitorStartsGspro, migrateSettings } from './store';

export type LauncherState = {
  /** True while a GSPro process exists on this PC (however it was started). */
  running: boolean;
  gsproPid: number | null;
  lmPid: number | null;
  startedAt: string | null;
  lastError: string | null;
  /**
   * Who started the current session: GSPro spawned by us, the launch-monitor
   * program we spawned (IDRAMonitor.exe starts GSPro itself), or something
   * outside the kiosk (GolfIn Launcher, a desktop shortcut).
   */
  sessionOwner: 'gspro' | 'launchMonitor' | 'external' | null;
};

type Listener = (s: LauncherState) => void;

let gspro: ChildProcess | null = null;
let lm: ChildProcess | null = null;
let state: LauncherState = { running: false, gsproPid: null, lmPid: null, startedAt: null, lastError: null, sessionOwner: null };
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(state);
}

export function onLauncherChange(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getLauncherState() {
  return state;
}

function spawnDetached(exe: string): ChildProcess | null {
  if (!exe) return null;
  if (!fs.existsSync(exe)) {
    throw new Error(`Not found: ${exe}`);
  }
  const child = spawn(exe, [], {
    cwd: path.dirname(exe),
    detached: false,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.on('error', (err) => log.error(`[launcher] ${path.basename(exe)} error`, err));
  return child;
}

// ---------- GSPro presence (the real "session is running" signal) ----------
//
// We cannot rely on the exit of the process we spawned:
//  - IDRAMonitor.exe (GolfIn IDRA II) starts GSPro and then may exit on its own
//    (seen on a PC without CUDA: IDRA quits 2 s after start, the monitor
//    follows, GSPro keeps running).
//  - Staff may start GSPro through the GolfIn Launcher instead of Play.
// So the session is simply "a GSPro.exe process exists", polled with tasklist.

const GSPRO_POLL_MS = 2000;
/** How long after Play we keep "running" while waiting for GSPro to appear. */
const GSPRO_START_GRACE_MS = 45_000;
/**
 * Home stays up until GSPro owns a window, not for a fixed time after its
 * process appears: the gap between the two varies with the GSPro build and how
 * busy the PC is, and stepping aside inside it shows the Windows desktop.
 * Once `gsproPid` is set the poller puts home underneath GSPro's window
 * (windows.parkHomeBehind), which needs that window to exist.
 */
const GSPRO_WINDOW_POLL_MS = 200;
/** Give up waiting for the window after this long and let home step aside anyway. */
const GSPRO_WINDOW_WAIT_MS = 60_000;
/** Used when the window check itself could not run: GSPro's window showed 11.7 s after its process on the Clarksville PC (15 Nov 2026). */
const GSPRO_WINDOW_FALLBACK_MS = 12_000;

function gsproImageName(): string {
  const p = getSettings().gsproPath;
  return (p && path.basename(p)) || 'GSPro.exe';
}

/** Run tasklist; `undefined` when it failed, timed out or could not be spawned (PC out of memory). */
function tasklist(args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      execFile('tasklist.exe', args, { windowsHide: true, timeout: 8000 }, (err, stdout) => resolve(err ? undefined : stdout));
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Resolve the pid of a running GSPro: a number, `null` when tasklist ran and
 * found none, or `undefined` when tasklist itself failed/timed out (the PC is
 * busy; GSPro loading pegs the disk) — callers must treat that as "unknown".
 */
export async function findGsproPid(): Promise<number | null | undefined> {
  if (process.platform !== 'win32') return null;
  const stdout = await tasklist(['/FI', `IMAGENAME eq ${gsproImageName()}`, '/FO', 'CSV', '/NH']);
  if (stdout === undefined) return undefined;
  // "GSPro.exe","12345","Console","1","1,234 K"   or   INFO: No tasks are running...
  const m = stdout.match(/^"[^"]+","(\d+)"/m);
  if (m) return parseInt(m[1], 10);
  return /no tasks/i.test(stdout) || stdout.trim() === '' ? null : undefined;
}

/**
 * Wait for GSPro's first *visible* window. Resolves `'window'` once it is on
 * screen, `'gone'` if the process exits first (it crashed while starting),
 * `'timeout'`, or `'unknown'` when the check could not run at all.
 *
 * GSPro (Unity) creates its window hidden as soon as the process starts and
 * only shows it about ten seconds later. `tasklist /V` reports the title of
 * that hidden window, so it cannot be used here: home was hidden 9 s too early
 * and the player saw the desktop, then the kiosk again, then GSPro. .NET's
 * `Process.MainWindowHandle` only counts visible windows, so one PowerShell
 * polls that until it is non-zero.
 */
function waitForGsproWindow(pid: number): Promise<'window' | 'gone' | 'timeout' | 'unknown'> {
  const script = [
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    'if (-not $p) { exit 2 }',
    `$end = (Get-Date).AddMilliseconds(${GSPRO_WINDOW_WAIT_MS})`,
    'while ((Get-Date) -lt $end) {',
    '  try { $p.Refresh(); if ($p.HasExited) { exit 2 } } catch { exit 2 }',
    '  if ($p.MainWindowHandle -ne [IntPtr]::Zero) { exit 0 }',
    `  Start-Sleep -Milliseconds ${GSPRO_WINDOW_POLL_MS}`,
    '}',
    'exit 3',
  ].join('\n');
  return new Promise((resolve) => {
    try {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: GSPRO_WINDOW_WAIT_MS + 15_000 },
        (err) => {
          // For a process that ran and exited non-zero, execFile puts the exit code in err.code.
          const code: unknown = err ? (err as { code?: unknown }).code : 0;
          resolve(code === 0 ? 'window' : code === 2 ? 'gone' : code === 3 ? 'timeout' : 'unknown');
        },
      );
    } catch {
      resolve('unknown'); // could not spawn (PC out of memory)
    }
  });
}

/** Consecutive "not found" polls needed before a seen session is declared over. */
const EXIT_CONFIRM_POLLS = 2;
let misses = 0;

let watch: NodeJS.Timeout | null = null;
let polling = false;
/** Set by Play / Test so a session that has not produced a GSPro yet is not declared over. */
let pendingSince = 0;
let pendingOwner: LauncherState['sessionOwner'] = null;
/** The watcher has seen a GSPro process for the current session. */
let seen = false;

function endSession(patch: Partial<LauncherState> = {}) {
  state = { ...state, running: false, gsproPid: null, sessionOwner: null, ...patch };
  pendingSince = 0;
  pendingOwner = null;
  seen = false;
  misses = 0;
  emit();
}

async function tick() {
  if (polling) return;
  polling = true;
  try {
    const pid = await findGsproPid();
    if (pid === undefined) return; // could not tell this round; keep current state

    if (pid) {
      misses = 0;
      if (!state.running || state.gsproPid !== pid || !seen) {
        const owner = state.running ? state.sessionOwner : pendingOwner ?? 'external';
        if (!state.running) log.info(`[launcher] GSPro detected (pid ${pid}, started by ${owner})`);
        // GSPro's first window appears a while after the process does; keep home
        // up until it exists so the bare desktop never shows in between.
        if (!seen) {
          const waitedFrom = Date.now();
          const win = await waitForGsproWindow(pid);
          if (win === 'gone') {
            // GSPro exited before it ever showed a window: it crashed while
            // starting. Home never stepped aside; say so instead of leaving
            // "starting" up until the grace period runs out.
            log.warn(`[launcher] GSPro (pid ${pid}) exited ${Date.now() - waitedFrom} ms after starting, before showing a window`);
            if (state.running) endSession({ lastError: 'GSPro closed while it was starting. Press Play to try again.' });
            return;
          }
          if (win === 'unknown') {
            log.warn(`[launcher] could not check for GSPro's window; waiting ${GSPRO_WINDOW_FALLBACK_MS} ms instead`);
            await new Promise((r) => setTimeout(r, Math.max(0, GSPRO_WINDOW_FALLBACK_MS - (Date.now() - waitedFrom))));
          } else {
            log.info(`[launcher] GSPro window ${win === 'window' ? 'visible' : 'not seen (timed out)'} after ${Date.now() - waitedFrom} ms`);
          }
        }
        state = {
          ...state,
          running: true,
          gsproPid: pid,
          startedAt: state.running ? state.startedAt : new Date().toISOString(),
          sessionOwner: owner,
        };
        pendingSince = 0;
        pendingOwner = null;
        seen = true;
        emit();
      }
      return;
    }

    // No GSPro process.
    if (state.running && seen) {
      if (++misses < EXIT_CONFIRM_POLLS) return;
      log.info('[launcher] GSPro exited');
      endSession();
    } else if (state.running && pendingSince && Date.now() - pendingSince > GSPRO_START_GRACE_MS) {
      log.warn('[launcher] GSPro never appeared after Play');
      endSession({ lastError: 'GSPro did not start. Check the paths under Settings → Play button.' });
    }
  } finally {
    polling = false;
  }
}

/** Start the GSPro presence watcher (idempotent). Called once at boot. */
export function startWatching() {
  if (watch || process.platform !== 'win32') return;
  watch = setInterval(tick, GSPRO_POLL_MS);
  void tick();
}

export function stopWatching() {
  if (watch) clearInterval(watch);
  watch = null;
}

function beginSession(owner: NonNullable<LauncherState['sessionOwner']>) {
  pendingSince = Date.now();
  pendingOwner = owner;
  seen = false;
  misses = 0;
  state = { ...state, running: true, startedAt: new Date().toISOString(), sessionOwner: owner, lastError: null };
}

// ---------- Play ----------

/**
 * "Play": make sure a GSPro session is running and hide the home screen.
 *
 * - GolfIn IDRA II (`IDRAMonitor.exe`): that program starts GSPro.exe and the
 *   IDRA.exe connector itself, exactly like the GolfIn Launcher's IDRA tile
 *   (verified 27 Oct 2026: GolfIn Launcher 10.3.1 / IDRA 8.2.6 / GSPro 3.1.6).
 *   Starting GSPro.exe ourselves too would give a GSPro with no launch
 *   monitor, so Play only starts the monitor.
 * - Other launch monitors: start their program (if configured) and GSPro.
 * - If GSPro is already running (pressed twice, or started via GolfIn), do not
 *   start anything; just mark the session running so home hides again.
 */
export function launchPlay(): LauncherState {
  state = { ...state, lastError: null };

  if (state.running && (seen || pendingSince)) {
    log.info(`[launcher] Play pressed while GSPro is ${seen ? 'already running' : 'still starting'}; not starting another`);
    emit();
    return state;
  }

  // An IDRA update since the last Play leaves the saved path on the old version.
  const moved = migrateSettings();
  if (moved) log.info(`[launcher] ${moved}`);
  const s = getSettings();

  if (s.launchMonitorPath && launchMonitorStartsGspro(s.launchMonitorPath)) {
    try {
      lm = spawnDetached(s.launchMonitorPath);
      log.info(`[launcher] ${path.basename(s.launchMonitorPath)} started (pid ${lm?.pid}); it starts GSPro itself`);
      lm?.on('exit', (code) => log.info(`[launcher] ${path.basename(s.launchMonitorPath)} exited (${code})`));
      beginSession('launchMonitor');
      state.lmPid = lm?.pid ?? null;
    } catch (e) {
      state = { ...state, running: false, lastError: e instanceof Error ? e.message : String(e), sessionOwner: null };
      log.error('[launcher] launch monitor', state.lastError);
    }
    emit();
    return state;
  }

  try {
    if (s.launchMonitorPath && (!lm || lm.exitCode !== null)) {
      lm = spawnDetached(s.launchMonitorPath);
      state.lmPid = lm?.pid ?? null;
      lm?.on('exit', () => {
        state = { ...state, lmPid: null };
        emit();
      });
    }
  } catch (e) {
    // Launch monitor missing shouldn't block GSPro — report and continue.
    state.lastError = e instanceof Error ? e.message : String(e);
    log.warn('[launcher] launch monitor', state.lastError);
  }

  try {
    gspro = spawnDetached(s.gsproPath);
    const lmErr = state.lastError;
    beginSession('gspro');
    // gsproPid is left for the watcher to set once GSPro has a window; setting
    // it here would hide home straight away, before GSPro has drawn anything.
    state = { ...state, lastError: lmErr };
    gspro?.on('exit', (code) => log.info(`[launcher] GSPro (spawned) exited (${code})`));
  } catch (e) {
    state = { ...state, running: false, lastError: e instanceof Error ? e.message : String(e), sessionOwner: null };
    log.error('[launcher] GSPro', state.lastError);
  }

  emit();
  return state;
}

/** Settings → "Test" next to a path: start just that one program. */
export function launchHelperOnly(which: 'launchMonitor' | 'gspro'): LauncherState {
  const moved = which === 'launchMonitor' ? migrateSettings() : null;
  if (moved) log.info(`[launcher] ${moved}`);
  const s = getSettings();
  try {
    const exe = which === 'gspro' ? s.gsproPath : s.launchMonitorPath;
    const child = spawnDetached(exe);
    if (which === 'gspro') {
      gspro = child;
      beginSession('gspro');
    } else if (launchMonitorStartsGspro(exe)) {
      lm = child;
      beginSession('launchMonitor');
      state.lmPid = child?.pid ?? null;
    } else {
      lm = child;
      state = { ...state, lmPid: child?.pid ?? null, lastError: null };
    }
  } catch (e) {
    state = { ...state, lastError: e instanceof Error ? e.message : String(e) };
  }
  emit();
  return state;
}

// ---------- Close everything (idle timeout / staff) ----------

/** Programs that make up a bay session, beyond GSPro itself. */
export const SESSION_IMAGES = ['IDRA.exe', 'IDRAMonitor.exe', 'GolfInLauncher.exe'];

function taskkill(images: string[], force: boolean): Promise<void> {
  if (process.platform !== 'win32' || !images.length) return Promise.resolve();
  const args = images.flatMap((im) => ['/IM', im]).concat('/T', force ? ['/F'] : []);
  return new Promise((resolve) => execFile('taskkill.exe', args, { windowsHide: true, timeout: 15_000 }, () => resolve()));
}

/**
 * End the session: close GSPro, the launch-monitor software and the GolfIn
 * Launcher. Polite close first (WM_CLOSE; GSPro exits cleanly on it), then
 * force anything still alive a few seconds later. Home comes back through the
 * normal GSPro-presence watcher.
 */
export async function closeSession(reason: string): Promise<void> {
  const s = getSettings();
  const images = Array.from(new Set([gsproImageName(), ...SESSION_IMAGES, ...(s.launchMonitorPath ? [path.basename(s.launchMonitorPath)] : [])]));
  log.info(`[launcher] closing session (${reason}): ${images.join(', ')}`);
  await taskkill(images, false);
  await new Promise((r) => setTimeout(r, 5000));
  if (await findGsproPid()) {
    log.warn('[launcher] GSPro still running after polite close; forcing');
  }
  await taskkill(images, true);
  void tick();
}

/**
 * Close the whole session and start it again, exactly as if the player pressed
 * Play on the home screen (used by "Exit the game" on the too-many-players
 * modal, so the bay comes back ready at the GSPro menu).
 */
export async function restartSession(reason: string): Promise<LauncherState> {
  await closeSession(reason);
  // Wait for the watcher to confirm GSPro is gone (it takes a couple of polls).
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && (state.running || (await findGsproPid()))) {
    await new Promise((r) => setTimeout(r, 500));
    void tick();
  }
  if (state.running) endSession();
  // IDRA / the GolfIn launcher release the launch monitor a beat after exiting.
  await new Promise((r) => setTimeout(r, 2000));
  log.info(`[launcher] relaunching session after ${reason}`);
  return launchPlay();
}

export function pathsExist() {
  const s = getSettings();
  return {
    launchMonitor: !!s.launchMonitorPath && fs.existsSync(s.launchMonitorPath),
    gspro: !!s.gsproPath && fs.existsSync(s.gsproPath),
    golfinLauncher: !!s.golfinLauncherPath && fs.existsSync(s.golfinLauncherPath),
    idraCalibration: !!s.idraCalibrationPath && fs.existsSync(s.idraCalibrationPath),
    idraUpdates: !!s.idraUpdatesPath && fs.existsSync(s.idraUpdatesPath),
  };
}
