import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import log from 'electron-log';

/**
 * Reads GSPro's screen.
 *
 * GSPro (Unity) exposes no API for "which screen is showing" or "how many
 * players are in this round", so the kiosk OCRs the display with the Windows
 * built-in OCR engine (resources/screen-ocr.ps1, a persistent PowerShell worker)
 * and pattern-matches the text GSPro 3.x draws:
 *
 *   setup  "ROUND SETTINGS" header; each occupied player slot has a
 *          "Change/Select Team / Color" row, an unfilled one reads "Empty Slot".
 *   round  hole card top-right ("PAR 3"), scoreboard top-left with one
 *          "<n> yds" row per player (current player large, the rest compact).
 *   range  "DRIVING RANGE DISTANCE" + the data tiles ("SIDE SPIN", "BACK SPIN").
 *
 * A scan takes ~200-400 ms on a laptop. Scans are skipped while the kiosk's own
 * overlay is up (it would read our modal, not GSPro).
 */

export type ScreenKind = 'unknown' | 'menu' | 'setup' | 'round' | 'range';

export interface GsproScreen {
  kind: ScreenKind;
  /** Players seen on setup / round screens; null when not applicable or unreadable. */
  playerCount: number | null;
  at: string | null;
  /** The OCR worker could not be started (missing OCR language pack, policy, …). */
  unavailable: boolean;
}

interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface ScanResult {
  ok: boolean;
  w?: number;
  h?: number;
  ms?: number;
  lines?: OcrLine[];
  error?: string;
}

const SCAN_INTERVAL_MS = 2500;
/** Mid-round and within the allowance: nothing to catch until they leave the round. */
const SCAN_INTERVAL_RELAXED_MS = 30_000;
const SCAN_TIMEOUT_MS = 8000;
/** A reading must repeat this many times before it is published (dropdowns, transitions). */
const STABLE_SCANS = 2;

let current: GsproScreen = { kind: 'unknown', playerCount: null, at: null, unavailable: false };
const listeners = new Set<(s: GsproScreen) => void>();

let worker: ChildProcessWithoutNullStreams | null = null;
let workerReady = false;
let pending: { resolve: (r: ScanResult) => void; timer: NodeJS.Timeout } | null = null;
let timer: NodeJS.Timeout | null = null;
let active = false;
let shouldSkip: () => boolean = () => false;
let isRelaxed: () => boolean = () => false;
let candidate: { kind: ScreenKind; playerCount: number | null; seen: number } | null = null;
let failures = 0;

export function getScreen(): GsproScreen {
  return current;
}

export function onScreenChange(cb: (s: GsproScreen) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function scriptPath(): string {
  const packaged = path.join(process.resourcesPath, 'screen-ocr.ps1');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, '..', '..', 'resources', 'screen-ocr.ps1');
  return fs.existsSync(dev) ? dev : packaged;
}

function startWorker(): Promise<boolean> {
  if (worker) return Promise.resolve(workerReady);
  return new Promise((resolve) => {
    const script = scriptPath();
    if (!fs.existsSync(script)) {
      log.error(`[screen] OCR worker script missing: ${script}`);
      markUnavailable();
      return resolve(false);
    }
    let settled = false;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    worker = child;
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      let msg: ScanResult & { ready?: boolean };
      try {
        msg = JSON.parse(line);
      } catch {
        // Windows PowerShell's ConvertTo-Json leaves raw control characters in
        // strings; strip them and try once more before giving up on the line.
        try {
          // eslint-disable-next-line no-control-regex
          msg = JSON.parse(line.replace(/[\x00-\x1f\x7f]/g, ''));
        } catch {
          log.warn(`[screen] unparsable worker line (${line.length} chars)`);
          if (pending) {
            clearTimeout(pending.timer);
            const p = pending;
            pending = null;
            p.resolve({ ok: false, error: 'bad worker output' });
          }
          return;
        }
      }
      if (msg.ready) {
        workerReady = true;
        if (!settled) {
          settled = true;
          resolve(true);
        }
        return;
      }
      if (pending) {
        clearTimeout(pending.timer);
        const p = pending;
        pending = null;
        p.resolve(msg);
      }
    });
    child.stderr.on('data', (d) => log.warn(`[screen] worker: ${String(d).trim().slice(0, 300)}`));
    child.on('exit', (code) => {
      log.warn(`[screen] OCR worker exited (${code})`);
      worker = null;
      workerReady = false;
      if (pending) {
        clearTimeout(pending.timer);
        const p = pending;
        pending = null;
        p.resolve({ ok: false, error: 'worker exited' });
      }
      if (!settled) {
        settled = true;
        if (code !== 0) markUnavailable();
        resolve(false);
      }
    });
    child.on('error', (err) => {
      log.error('[screen] cannot start OCR worker', err.message);
      worker = null;
      if (!settled) {
        settled = true;
        markUnavailable();
        resolve(false);
      }
    });
  });
}

function stopWorker() {
  const w = worker;
  worker = null;
  workerReady = false;
  if (!w) return;
  try {
    w.stdin.write('quit\n');
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      if (w.exitCode === null) w.kill();
    } catch {
      /* ignore */
    }
  }, 1500);
}

function markUnavailable() {
  if (!current.unavailable) {
    current = { ...current, unavailable: true };
    emit();
  }
}

function emit() {
  for (const cb of listeners) {
    try {
      cb(current);
    } catch (e) {
      log.warn('[screen] listener failed', (e as Error).message);
    }
  }
}

function scan(): Promise<ScanResult> {
  if (!worker || !workerReady) return Promise.resolve({ ok: false, error: 'worker not ready' });
  if (pending) return Promise.resolve({ ok: false, error: 'scan in progress' });
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      if (pending) {
        pending = null;
        resolve({ ok: false, error: 'timeout' });
        // A hung worker is useless; restart it on the next tick.
        stopWorker();
      }
    }, SCAN_TIMEOUT_MS);
    pending = { resolve, timer: t };
    try {
      worker!.stdin.write('scan\n');
    } catch (e) {
      clearTimeout(t);
      pending = null;
      resolve({ ok: false, error: (e as Error).message });
    }
  });
}

// ---------- Classification ----------

const RE_SETUP = /ROUND\s*SETTINGS/i;
const RE_SLOT = /Team\s*\/\s*Color/i;
const RE_EMPTY_SLOT = /Empty\s*Slot/i;
const RE_PAR = /\bPAR\s*[3-6]\b/i;
const RE_YDS = /\b\d+(?:\.\d+)?\s*yds\b/i;
const RE_RANGE = /DRIVING\s*RANGE|SIDE\s*SPIN|BACK\s*SPIN|PRACTICE\s*RANGE/i;
const RE_MENU = /^WELCOME$|quest for the perfect swing|^SELECT\s*COURSE$/i;

export function classify(lines: OcrLine[], w: number, h: number): { kind: ScreenKind; playerCount: number | null } {
  const texts = lines.map((l) => l.text);
  if (texts.some((t) => RE_SETUP.test(t))) {
    const slots = texts.filter((t) => RE_SLOT.test(t)).length;
    const empty = texts.filter((t) => RE_EMPTY_SLOT.test(t)).length;
    // An open dropdown lists "Empty Slot" twice; never go below the slots we saw.
    return { kind: 'setup', playerCount: Math.max(0, slots - Math.min(empty, slots)) };
  }
  // Round: hole card (top-right) + scoreboard rows (top-left). Transparent-HUD
  // layouts can hide the scoreboard, so a hole card alone is still "round".
  const topRight = lines.filter((l) => l.x > w * 0.6 && l.y < h * 0.15);
  const topLeft = lines.filter((l) => l.x < w * 0.45 && l.y < h * 0.55);
  const hasPar = topRight.some((l) => RE_PAR.test(l.text));
  const ydsRows = topLeft.filter((l) => RE_YDS.test(l.text)).length;
  const rangeHit = topLeft.filter((l) => RE_RANGE.test(l.text)).length;
  if (rangeHit >= 1 && !hasPar) return { kind: 'range', playerCount: null };
  if (hasPar || ydsRows >= 2) return { kind: 'round', playerCount: ydsRows > 0 ? ydsRows : null };
  if (texts.some((t) => RE_MENU.test(t.trim()))) return { kind: 'menu', playerCount: null };
  return { kind: 'unknown', playerCount: null };
}

// ---------- Loop ----------

async function tick() {
  if (!active) return;
  try {
    if (shouldSkip()) return;
    if (!worker) {
      const ok = await startWorker();
      if (!ok) {
        failures++;
        return;
      }
    }
    const r = await scan();
    if (!r.ok || !r.lines || !r.w || !r.h) {
      failures++;
      if (failures === 3) log.warn(`[screen] scans failing: ${r.error ?? 'unknown'}`);
      return;
    }
    failures = 0;
    const c = classify(r.lines, r.w, r.h);
    if (candidate && candidate.kind === c.kind && candidate.playerCount === c.playerCount) candidate.seen++;
    else candidate = { ...c, seen: 1 };
    if (candidate.seen >= STABLE_SCANS && (current.kind !== c.kind || current.playerCount !== c.playerCount)) {
      current = { kind: c.kind, playerCount: c.playerCount, at: new Date().toISOString(), unavailable: false };
      log.info(`[screen] ${c.kind}${c.playerCount != null ? ` players=${c.playerCount}` : ''} (${r.ms} ms)`);
      emit();
    }
  } catch (e) {
    log.warn('[screen] tick failed', (e as Error).message);
  } finally {
    if (active) timer = setTimeout(tick, nextInterval());
  }
}

/**
 * Scan pace. Fast while the player is choosing/setting up (menu, round
 * settings, range, unknown) so a change is caught within seconds. Once a round
 * is under way and the host says it is fine (within the allowance, or not
 * enforced) there is nothing to catch until they leave the round, so back off;
 * the next scan that shows the menu/setup screen speeds things up again.
 */
function nextInterval(): number {
  if (current.kind === 'round' && isRelaxed()) return SCAN_INTERVAL_RELAXED_MS;
  return SCAN_INTERVAL_MS;
}

/**
 * Start watching while a GSPro session runs. `skip` returns true when a scan
 * would be pointless (our own overlay is covering the screen); `relaxed`
 * returns true when the current round needs no close attention.
 */
export function startWatching(skip: () => boolean, relaxed: () => boolean = () => false) {
  shouldSkip = skip;
  isRelaxed = relaxed;
  if (active) return;
  if (process.platform !== 'win32') return;
  active = true;
  failures = 0;
  candidate = null;
  log.info('[screen] watching GSPro screen');
  void tick();
}

export function stopWatching() {
  if (!active) return;
  active = false;
  if (timer) clearTimeout(timer);
  timer = null;
  stopWorker();
  candidate = null;
  if (current.kind !== 'unknown' || current.playerCount !== null) {
    current = { kind: 'unknown', playerCount: null, at: null, unavailable: current.unavailable };
    emit();
  }
}

/** One-off scan for diagnostics (Settings → Test). */
export async function scanOnce(): Promise<{ ok: boolean; kind: ScreenKind; playerCount: number | null; ms: number; sample: string[]; error?: string }> {
  const started = !!worker || (await startWorker());
  if (!started) return { ok: false, kind: 'unknown', playerCount: null, ms: 0, sample: [], error: 'OCR worker unavailable' };
  const r = await scan();
  if (!r.ok || !r.lines || !r.w || !r.h) return { ok: false, kind: 'unknown', playerCount: null, ms: r.ms ?? 0, sample: [], error: r.error };
  const c = classify(r.lines, r.w, r.h);
  const out = { ok: true, ...c, ms: r.ms ?? 0, sample: r.lines.slice(0, 40).map((l) => l.text) };
  if (!active) stopWorker();
  return out;
}
