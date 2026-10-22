import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { getSettings } from './store';

export type LauncherState = {
  running: boolean;
  gsproPid: number | null;
  lmPid: number | null;
  startedAt: string | null;
  lastError: string | null;
};

type Listener = (s: LauncherState) => void;

let gspro: ChildProcess | null = null;
let lm: ChildProcess | null = null;
let state: LauncherState = { running: false, gsproPid: null, lmPid: null, startedAt: null, lastError: null };
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

/**
 * "Play": start the launch-monitor software (if configured and not already
 * running) and GSPro. The home screen hides while GSPro runs and comes back
 * when GSPro exits.
 */
export function launchPlay(): LauncherState {
  const s = getSettings();
  state = { ...state, lastError: null };

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
    if (!gspro || gspro.exitCode !== null) {
      gspro = spawnDetached(s.gsproPath);
      state = { ...state, running: true, gsproPid: gspro?.pid ?? null, startedAt: new Date().toISOString() };
      gspro?.on('exit', (code) => {
        log.info(`[launcher] GSPro exited (${code})`);
        state = { ...state, running: false, gsproPid: null };
        emit();
      });
    }
  } catch (e) {
    state = { ...state, running: false, lastError: e instanceof Error ? e.message : String(e) };
    log.error('[launcher] GSPro', state.lastError);
  }

  emit();
  return state;
}

export function launchHelperOnly(which: 'launchMonitor' | 'gspro'): LauncherState {
  const s = getSettings();
  try {
    const exe = which === 'gspro' ? s.gsproPath : s.launchMonitorPath;
    const child = spawnDetached(exe);
    if (which === 'gspro') {
      gspro = child;
      state = { ...state, running: true, gsproPid: child?.pid ?? null, startedAt: new Date().toISOString(), lastError: null };
      child?.on('exit', () => {
        state = { ...state, running: false, gsproPid: null };
        emit();
      });
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
