import { app } from 'electron';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import log from 'electron-log';
import { currentSid } from './lockdown';

const execFileP = promisify(execFile);

/**
 * PC cleanup: strip a bay PC down to what the kiosk, the launch-monitor software
 * and GSPro need.
 *
 * All of the Windows work is in resources/pc-setup.ps1, which holds the lists
 * (which apps go, which settings change) and explains what is deliberately
 * kept. This module only runs it:
 *
 *  - status: unelevated and read-only; what would be removed and which tuning
 *    is already in place on this PC.
 *  - apply / undo: one elevated PowerShell (one UAC prompt, like lockdown.ts).
 *    Windows itself is the source of truth; nothing is stored in kiosk settings
 *    and nothing is re-applied at startup.
 *
 * Tuning is reversible: the script records each setting's original value in
 * C:\ProgramData\Tee24\pc-setup-backup.json before changing it and undo puts
 * them back. Removed apps are not restored (reinstall from Microsoft Store).
 */

export const APP_GROUP_IDS = ['windows', 'office', 'oem'] as const;
export type AppGroupId = (typeof APP_GROUP_IDS)[number];

export type PcSetupStatus = {
  supported: boolean;
  /** Per group, the apps that are installed now and would be removed. */
  groups: { id: string; label: string; apps: string[] }[];
  /** `applicable: false` = this PC does not need that step (e.g. pagefile on a 16 GB PC). */
  tune: { id: string; label: string; on: boolean; applicable: boolean }[];
  /** A record of the original settings exists, so tuning can be undone. */
  canUndo: boolean;
};

type Problem = { label: string; error: string };

export type PcSetupResult = {
  status: PcSetupStatus;
  removed: string[];
  tuned: string[];
  skipped: { label: string; reason: string }[];
  failed: Problem[];
};

export type PcSetupUndoResult = { status: PcSetupStatus; restored: number; failed: Problem[] };

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const UAC_CANCELLED = 1223;

let busy = false;

function scriptPath(): string {
  const packaged = path.join(process.resourcesPath, 'pc-setup.ps1');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, '..', '..', 'resources', 'pc-setup.ps1');
  return fs.existsSync(dev) ? dev : packaged;
}

/** Windows PowerShell 5.1 emits a lone value where a one-item array was meant. */
function asArray<T>(v: unknown): T[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? (v as T[]) : [v as T];
}

export async function getStatus(): Promise<PcSetupStatus> {
  if (process.platform !== 'win32') return { supported: false, groups: [], tune: [], canUndo: false };
  const { stdout } = await execFileP('powershell.exe', [...PS_ARGS, '-File', scriptPath(), '-Mode', 'status'], {
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error('Could not read how this PC is set up.');
  const raw = JSON.parse(line) as { groups?: unknown; tune?: unknown; canUndo?: boolean };
  return {
    supported: true,
    groups: asArray<{ id: string; label: string; apps?: unknown }>(raw.groups).map((g) => ({ id: g.id, label: g.label, apps: asArray<string>(g.apps) })),
    tune: asArray<PcSetupStatus['tune'][number]>(raw.tune),
    canUndo: !!raw.canUndo,
  };
}

/** Runs the script elevated (one UAC prompt) and returns the JSON it wrote. */
async function runElevated(args: string[], onProgress?: (msg: string) => void): Promise<Record<string, unknown>> {
  if (process.platform !== 'win32') throw new Error('Windows only.');
  if (busy) throw new Error('A PC cleanup is already running.');
  busy = true;
  const stamp = `${process.pid}-${Date.now()}`;
  const out = path.join(os.tmpdir(), `tee24-pcsetup-${stamp}.json`);
  const progressFile = path.join(os.tmpdir(), `tee24-pcsetup-${stamp}.log`);
  let timer: NodeJS.Timeout | null = null;
  try {
    // UAC may elevate as a different admin account; the script is told which
    // Windows user the kiosk runs as so per-user settings land in the right hive.
    const sid = await currentSid();
    fs.writeFileSync(progressFile, '');
    const q = (s: string) => `"${s}"`;
    const inner = [...PS_ARGS, '-File', q(scriptPath()), ...args, '-UserSid', sid, '-Out', q(out), '-ProgressFile', q(progressFile)].join(' ');
    const outer =
      `try { $p = Start-Process -FilePath 'powershell.exe' -ArgumentList '${inner.replace(/'/g, "''")}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode }` +
      ` catch { exit ${UAC_CANCELLED} }`;

    // Removing Microsoft 365 alone can take several minutes; relay what the script is doing.
    let last = '';
    timer = setInterval(() => {
      try {
        const lines = fs.readFileSync(progressFile, 'utf8').replace(/\uFEFF/g, '').split(/\r?\n/).filter(Boolean);
        const msg = lines[lines.length - 1];
        if (msg && msg !== last) {
          last = msg;
          onProgress?.(msg);
        }
      } catch {
        /* not written yet */
      }
    }, 1000);

    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', outer], { windowsHide: true, stdio: 'ignore' });
      child.on('error', reject);
      child.on('exit', resolve);
    });
    if (code === UAC_CANCELLED) throw new Error('Cancelled at the Windows permission prompt.');

    let result: Record<string, unknown> | null = null;
    try {
      result = JSON.parse(fs.readFileSync(out, 'utf8').replace(/\uFEFF/g, '')) as Record<string, unknown>;
    } catch {
      /* the script died before it could report */
    }
    if (typeof result?.error === 'string') throw new Error(result.error);
    if (code !== 0 || !result) throw new Error(`The PC cleanup script failed (exit ${code}).`);
    return result;
  } finally {
    if (timer) clearInterval(timer);
    fs.rmSync(out, { force: true });
    fs.rmSync(progressFile, { force: true });
    busy = false;
  }
}

/** Remove the chosen app groups and/or apply the Windows tuning. One UAC prompt. */
export async function apply(opts: { groups?: string[]; tune?: boolean }, onProgress?: (msg: string) => void): Promise<PcSetupResult> {
  const groups = (opts?.groups ?? []).filter((g): g is AppGroupId => (APP_GROUP_IDS as readonly string[]).includes(g));
  const tune = !!opts?.tune;
  if (!groups.length && !tune) throw new Error('Nothing is selected.');

  const args = ['-Mode', 'apply'];
  if (groups.length) args.push('-Groups', groups.join(','));
  if (tune) args.push('-Tune');
  log.info(`[pcsetup] apply: groups=${groups.join(',') || '(none)'} tune=${tune}`);
  const r = await runElevated(args, onProgress);

  const result = {
    removed: asArray<string>(r.removed),
    tuned: asArray<string>(r.tuned),
    skipped: asArray<{ label: string; reason: string }>(r.skipped),
    failed: asArray<Problem>(r.failed),
  };
  log.info(`[pcsetup] removed ${result.removed.length} app(s): ${result.removed.join(', ') || '-'}`);
  log.info(`[pcsetup] tuned ${result.tuned.length} setting group(s); skipped ${result.skipped.length}`);
  for (const s of result.skipped) log.info(`[pcsetup] skipped: ${s.label} (${s.reason})`);
  for (const f of result.failed) log.warn(`[pcsetup] failed: ${f.label}: ${f.error}`);
  return { status: await getStatus(), ...result };
}

/** Put every tuned Windows setting back to what it was before the first apply. One UAC prompt. */
export async function undoTuning(onProgress?: (msg: string) => void): Promise<PcSetupUndoResult> {
  const r = await runElevated(['-Mode', 'undo'], onProgress);
  const failed = asArray<Problem>(r.failed);
  const restored = Number(r.restored) || 0;
  log.info(`[pcsetup] undo: restored ${restored} setting(s), ${failed.length} failed`);
  for (const f of failed) log.warn(`[pcsetup] undo failed: ${f.label}: ${f.error}`);
  return { status: await getStatus(), restored, failed };
}
