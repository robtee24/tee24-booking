import { spawn, execFile, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { getSettings, launchMonitorStartsGspro } from './store';

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
/** Delay between first seeing the GSPro process and hiding home (lets its window paint). */
const GSPRO_SETTLE_MS = 1500;

function gsproImageName(): string {
  const p = getSettings().gsproPath;
  return (p && path.basename(p)) || 'GSPro.exe';
}

/**
 * Resolve the pid of a running GSPro: a number, `null` when tasklist ran and
 * found none, or `undefined` when tasklist itself failed/timed out (the PC is
 * busy; GSPro loading pegs the disk) — callers must treat that as "unknown".
 */
export function findGsproPid(): Promise<number | null | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const image = gsproImageName();
  return new Promise((resolve) => {
    execFile(
      'tasklist.exe',
      ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) return resolve(undefined);
        // "GSPro.exe","12345","Console","1","1,234 K"   or   INFO: No tasks are running...
        const m = stdout.match(/^"[^"]+","(\d+)"/m);
        if (m) return resolve(parseInt(m[1], 10));
        resolve(/no tasks/i.test(stdout) || stdout.trim() === '' ? null : undefined);
      },
    );
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
        // GSPro's first window appears a moment after the process does; wait so
        // home does not drop away to the bare desktop before GSPro paints.
        if (!seen) await new Promise((r) => setTimeout(r, GSPRO_SETTLE_MS));
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
  const s = getSettings();
  state = { ...state, lastError: null };

  if (state.running && (seen || pendingSince)) {
    log.info(`[launcher] Play pressed while GSPro is ${seen ? 'already running' : 'still starting'}; not starting another`);
    emit();
    return state;
  }

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
    state = { ...state, gsproPid: gspro?.pid ?? null, lastError: lmErr };
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
  const s = getSettings();
  try {
    const exe = which === 'gspro' ? s.gsproPath : s.launchMonitorPath;
    const child = spawnDetached(exe);
    if (which === 'gspro') {
      gspro = child;
      beginSession('gspro');
      state.gsproPid = child?.pid ?? null;
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

export function pathsExist() {
  const s = getSettings();
  return {
    launchMonitor: !!s.launchMonitorPath && fs.existsSync(s.launchMonitorPath),
    gspro: !!s.gsproPath && fs.existsSync(s.gsproPath),
  };
}
