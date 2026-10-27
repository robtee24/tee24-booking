import { execFile } from 'child_process';
import path from 'path';
import log from 'electron-log';

/**
 * Start-at-login on Windows.
 *
 * Electron's `setLoginItemSettings` writes an HKCU\...\Run entry. Explorer
 * defers those behind every other startup app, which on a bay PC meant the
 * Windows desktop for a minute or more before the kiosk appeared. A Task
 * Scheduler "at logon" task for the current user fires as soon as the session
 * starts and can be registered without elevation, so that is the primary
 * mechanism; the Run entry stays off whenever the task is in place.
 */

export const TASK_NAME = 'Tee24 Bay Kiosk';

function ps(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).trim()));
        else resolve(stdout.trim());
      },
    );
  });
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Register (or re-register) the logon task pointing at `exe --autostart`. */
export async function registerLogonTask(exe: string): Promise<void> {
  const script = [
    `$a = New-ScheduledTaskAction -Execute ${q(exe)} -Argument '--autostart' -WorkingDirectory ${q(path.dirname(exe))}`,
    `$t = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\\$env:USERNAME"`,
    // ExecutionTimeLimit 0 = no limit (the default would kill the kiosk after 3 days).
    `$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable`,
    `$p = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Limited`,
    `Register-ScheduledTask -TaskName ${q(TASK_NAME)} -Action $a -Trigger $t -Settings $s -Principal $p -Description 'Opens the Tee24 Bay Kiosk when Windows starts.' -Force | Out-Null`,
    `'ok'`,
  ].join('; ');
  const out = await ps(script);
  if (out !== 'ok') throw new Error(out || 'Register-ScheduledTask returned nothing');
}

export async function unregisterLogonTask(): Promise<void> {
  await ps(`Unregister-ScheduledTask -TaskName ${q(TASK_NAME)} -Confirm:$false -ErrorAction SilentlyContinue; 'ok'`);
}

export async function logonTaskExists(): Promise<boolean> {
  const out = await ps(`if (Get-ScheduledTask -TaskName ${q(TASK_NAME)} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`);
  return out === 'yes';
}

export function logAutostart(msg: string) {
  log.info(`[autostart] ${msg}`);
}
