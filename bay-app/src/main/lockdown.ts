import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import log from 'electron-log';

const execFileP = promisify(execFile);

/**
 * Customer lockdown: make it hard to leave the kiosk / GSPro from the bay.
 *
 * Windows gives apps no way to swallow the Windows key or Ctrl+Alt+Del, so
 * this is done in the registry (one UAC prompt, fully reversible):
 *
 *  - Per-user policies under HKU\<sid>\...\Policies strip the Ctrl+Alt+Del
 *    screen down to "Cancel" (no Task Manager, Lock, Sign out, Switch user,
 *    Change password, power button) and disable the Win+<letter> hotkeys.
 *    Effective immediately. (The Policies keys are ACL'd so even the owning
 *    user needs elevation to write them.)
 *  - HKLM Scancode Map remaps both Windows keys to nothing at the keyboard
 *    driver level, so the bare key can't open Start. Read at sign-in, so it
 *    takes effect after the next restart.
 *
 * Staff keep access via the kiosk's own Settings, remote support and Ctrl+Esc.
 * The registry is the source of truth; nothing is re-applied at startup.
 */

const SYSTEM_POL = 'Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System';
const EXPLORER_POL = 'Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer';
const USER_POLICIES: Array<[subkey: string, name: string]> = [
  [SYSTEM_POL, 'DisableTaskMgr'],
  [SYSTEM_POL, 'DisableLockWorkstation'],
  [SYSTEM_POL, 'DisableChangePassword'],
  [SYSTEM_POL, 'HideFastUserSwitching'],
  [EXPLORER_POL, 'NoLogoff'],
  [EXPLORER_POL, 'NoClose'],
  [EXPLORER_POL, 'NoWinKeys'],
];
const KEYBOARD_LAYOUT = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Keyboard Layout';
/** Scancode Map: 8-byte header, 3 entries, left Win (E0 5B) -> 0, right Win (E0 5C) -> 0, terminator. */
const WIN_KEYS_OFF_MAP = '00000000000000000300000000005be000005ce000000000';

async function reg(args: string[]): Promise<string> {
  const { stdout } = await execFileP('reg.exe', args, { windowsHide: true, timeout: 10_000 });
  return stdout;
}

export type LockdownStatus = {
  supported: boolean;
  /** Ctrl+Alt+Del trimmed + Win+hotkeys off for this Windows user (all policies present). */
  userPolicies: boolean;
  /** Scancode Map present (Windows keys dead after the next sign-in). */
  winKeysDisabled: boolean;
  /** Both layers on. */
  on: boolean;
};

export async function getLockdownStatus(): Promise<LockdownStatus> {
  if (process.platform !== 'win32') return { supported: false, userPolicies: false, winKeysDisabled: false, on: false };
  let applied = 0;
  for (const [sub, name] of USER_POLICIES) {
    try {
      if (/0x1\s*$/m.test(await reg(['query', `HKCU\\${sub}`, '/v', name]))) applied++;
    } catch {
      /* absent */
    }
  }
  let winKeysDisabled = false;
  try {
    const out = await reg(['query', KEYBOARD_LAYOUT, '/v', 'Scancode Map']);
    winKeysDisabled = /5BE0/i.test(out) && /5CE0/i.test(out);
  } catch {
    /* absent */
  }
  const userPolicies = applied === USER_POLICIES.length;
  return { supported: true, userPolicies, winKeysDisabled, on: userPolicies && winKeysDisabled };
}

async function currentSid(): Promise<string> {
  const { stdout } = await execFileP(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],
    { windowsHide: true, timeout: 10_000 },
  );
  const sid = stdout.trim();
  if (!/^S-1-/.test(sid)) throw new Error('Could not determine the Windows user.');
  return sid;
}

/** Build the script the elevated PowerShell runs. Targets HKU\<sid> so it works even if UAC asks for a different admin account. */
function buildScript(on: boolean, sid: string): string {
  const lines: string[] = ['$ErrorActionPreference = "Stop"', `$u = "Registry::HKEY_USERS\\${sid}"`];
  const subs = Array.from(new Set(USER_POLICIES.map(([s]) => s)));
  for (const sub of subs) lines.push(`New-Item -Path "$u\\${sub}" -Force | Out-Null`);
  for (const [sub, name] of USER_POLICIES) {
    lines.push(
      on
        ? `New-ItemProperty -Path "$u\\${sub}" -Name "${name}" -PropertyType DWord -Value 1 -Force | Out-Null`
        : `Remove-ItemProperty -Path "$u\\${sub}" -Name "${name}" -ErrorAction SilentlyContinue`,
    );
  }
  lines.push(
    on
      ? `& reg.exe add "${KEYBOARD_LAYOUT}" /v "Scancode Map" /t REG_BINARY /d ${WIN_KEYS_OFF_MAP} /f | Out-Null`
      : `& reg.exe delete "${KEYBOARD_LAYOUT}" /v "Scancode Map" /f 2>$null | Out-Null`,
  );
  lines.push('exit 0');
  return lines.join('\r\n');
}

/** Turn the whole lockdown on or off. One UAC prompt. */
export async function setLockdown(on: boolean): Promise<LockdownStatus> {
  if (process.platform !== 'win32') throw new Error('Windows only.');
  const sid = await currentSid();
  const script = path.join(os.tmpdir(), `tee24-lockdown-${process.pid}.ps1`);
  fs.writeFileSync(script, buildScript(on, sid), 'utf8');
  const inner = `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${script}"`;
  const outer = `$p = Start-Process -FilePath 'powershell.exe' -ArgumentList '${inner.replace(/'/g, "''")}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', outer], { windowsHide: true, stdio: 'ignore' });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(code === 1223 ? 'Cancelled at the Windows permission prompt.' : `Lockdown script failed (exit ${code}).`));
      });
    });
  } finally {
    fs.rmSync(script, { force: true });
  }
  const st = await getLockdownStatus();
  log.info(`[lockdown] ${on ? 'enabled' : 'disabled'}: policies=${st.userPolicies} winKeys=${st.winKeysDisabled} (Windows keys change at next sign-in)`);
  if (on && !st.userPolicies) throw new Error('Windows accepted the change but the policies did not stick. Try again.');
  return st;
}
