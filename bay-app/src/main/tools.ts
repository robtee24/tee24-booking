import { spawn, execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { getSettings, updateSettings, findGolfinLauncher } from './store';
import { getLauncherState, SESSION_IMAGES } from './launcher';

/**
 * IDRA tools (admin-only): calibration and updates.
 *
 * Both screens live inside the GolfIn Launcher's Settings; GolfIn exposes no
 * command-line switch that opens either one directly. So the kiosk starts the
 * launcher (or a dedicated program the admin configured), steps out of the way
 * (poller "maintenance" mode hides the fullscreen home and shows a strip with
 * the next steps), and comes back when the admin presses "Back to kiosk".
 */

export type IdraTool = 'calibration' | 'updates';

export const IDRA_TOOL_LABELS: Record<IdraTool, string> = {
  calibration: 'IDRA calibration',
  updates: 'IDRA updates',
};

export type ResolvedTool = { exe: string; viaLauncher: boolean };

/** Which program opens a tool: the admin's override if set, else the GolfIn Launcher. */
export function resolveTool(tool: IdraTool): ResolvedTool | null {
  const s = getSettings();
  const override = (tool === 'calibration' ? s.idraCalibrationPath : s.idraUpdatesPath).trim();
  if (override) return { exe: override, viaLauncher: false };

  let launcher = (s.golfinLauncherPath || '').trim();
  if (!launcher || !fs.existsSync(launcher)) {
    const found = findGolfinLauncher();
    if (found) {
      launcher = found;
      updateSettings({ golfinLauncherPath: found });
      log.info(`[tools] GolfIn Launcher found at ${found}`);
    }
  }
  return launcher ? { exe: launcher, viaLauncher: true } : null;
}

function imageRunning(image: string): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(/^"[^"]+","\d+"/m.test(stdout));
    });
  });
}

export type OpenToolResult = ResolvedTool & { tool: IdraTool; alreadyRunning: boolean };

export async function openTool(tool: IdraTool): Promise<OpenToolResult> {
  const r = resolveTool(tool);
  if (!r) throw new Error('GolfIn Launcher was not found on this PC. Set its path under Settings → IDRA tools.');
  if (!fs.existsSync(r.exe)) throw new Error(`Not found: ${r.exe}`);

  const alreadyRunning = await imageRunning(path.basename(r.exe));
  if (alreadyRunning) {
    log.info(`[tools] ${tool}: ${path.basename(r.exe)} is already running`);
  } else {
    // Detached so the tool survives a kiosk restart/update while an admin is mid-calibration.
    const child = spawn(r.exe, [], { cwd: path.dirname(r.exe), detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', (err) => log.error(`[tools] ${path.basename(r.exe)} error`, err));
    child.unref();
    log.info(`[tools] ${tool}: started ${r.exe} (pid ${child.pid})`);
  }
  return { ...r, tool, alreadyRunning };
}

function taskkill(images: string[], force: boolean): Promise<void> {
  if (process.platform !== 'win32' || !images.length) return Promise.resolve();
  const args = images.flatMap((im) => ['/IM', im]).concat(force ? ['/F'] : []);
  return new Promise((resolve) => execFile('taskkill.exe', args, { windowsHide: true, timeout: 15_000 }, () => resolve()));
}

/**
 * Close the tool programs when the admin returns to the kiosk. Skipped while a
 * GSPro session is running: the GolfIn Launcher may be that session's parent
 * (its IDRA tile started IDRAMonitor → GSPro), and closing it would end the round.
 */
export async function closeTools(): Promise<boolean> {
  if (getLauncherState().running) {
    log.info('[tools] GSPro is running; leaving the GolfIn Launcher open');
    return false;
  }
  // The launcher plus anything it may have started (IDRAMonitor/IDRA), same set the
  // idle-close uses, plus any dedicated tool programs the admin configured.
  const s = getSettings();
  const images = Array.from(
    new Set(
      [...SESSION_IMAGES, s.golfinLauncherPath, s.idraCalibrationPath, s.idraUpdatesPath]
        .filter(Boolean)
        .map((p) => path.basename(p)),
    ),
  );
  log.info(`[tools] closing: ${images.join(', ')}`);
  await taskkill(images, false);
  await new Promise((r) => setTimeout(r, 2500));
  await taskkill(images, true);
  return true;
}
