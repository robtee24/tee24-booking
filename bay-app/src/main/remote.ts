import { app } from 'electron';
import { execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import log from 'electron-log';
import { getSettings, updateSettings } from './store';

const execFileP = promisify(execFile);

/**
 * Remote support = MeshCentral agent (open source, Apache-2.0). The agent is
 * downloaded from our own MeshCentral server (URL comes from /api/bay-app/status
 * → `remote.agentUrl`), installed as a Windows service, and dials out to the
 * server — no inbound ports on the bay PC. Admins connect from the admin
 * Troubleshoot tab; the kiosk reports its Mesh node id via the status heartbeat
 * so the admin UI can deep-link straight to this machine.
 */

const AGENT_DIR = 'C:\\Program Files\\Mesh Agent';
const AGENT_EXE = path.join(AGENT_DIR, 'MeshAgent.exe');

export type RemoteAgentStatus = {
  supported: boolean;
  installed: boolean;
  nodeId: string | null;
  installedAt: string | null;
  serverUrl: string | null;
};

let lastServerUrl: string | null = null;
let lastAgentUrl: string | null = null;

export function rememberRemoteInfo(info: { serverUrl: string; agentUrl: string | null } | null) {
  lastServerUrl = info?.serverUrl ?? null;
  lastAgentUrl = info?.agentUrl ?? null;
}

export function agentInstalled(): boolean {
  return process.platform === 'win32' && fs.existsSync(AGENT_EXE);
}

export async function getRemoteAgentStatus(): Promise<RemoteAgentStatus> {
  const s = getSettings();
  const installed = agentInstalled();
  let nodeId = s.remoteNodeId;
  if (installed && !nodeId) {
    nodeId = await readNodeId();
    if (nodeId) updateSettings({ remoteNodeId: nodeId });
  }
  return {
    supported: process.platform === 'win32',
    installed,
    nodeId,
    installedAt: s.remoteAgentInstalledAt,
    serverUrl: lastServerUrl,
  };
}

/** `MeshAgent.exe -nodeid` prints the agent's node id. */
export async function readNodeId(): Promise<string | null> {
  if (!agentInstalled()) return null;
  try {
    const { stdout } = await execFileP(AGENT_EXE, ['-nodeid'], { timeout: 10_000, windowsHide: true });
    const id = stdout.trim().split(/\r?\n/).pop()?.trim() ?? '';
    return id.length > 20 ? id : null;
  } catch (e) {
    log.warn('[remote] -nodeid failed', e);
    return null;
  }
}

/**
 * Download the agent from our MeshCentral server and run `-fullinstall`
 * elevated (UAC prompt). Called from the admin Settings screen during setup.
 */
export async function installAgent(onProgress: (msg: string) => void): Promise<RemoteAgentStatus> {
  if (process.platform !== 'win32') throw new Error('Remote support agent is Windows-only.');
  if (!lastAgentUrl) throw new Error('Remote support is not configured on the server yet (MESHCENTRAL_URL / MESHCENTRAL_MESH_ID).');

  const tmp = path.join(app.getPath('temp'), 'tee24-meshagent.exe');
  onProgress('Downloading remote support agent…');
  const res = await fetch(lastAgentUrl);
  if (!res.ok) throw new Error(`Agent download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500_000) throw new Error('Agent download looks incomplete — check the MeshCentral mesh id.');
  fs.writeFileSync(tmp, buf);

  onProgress('Installing (approve the Windows prompt)…');
  await runElevated(tmp, ['-fullinstall']);

  // Service start is async; give it a moment then read the id.
  onProgress('Starting agent…');
  let nodeId: string | null = null;
  for (let i = 0; i < 10 && !nodeId; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    nodeId = await readNodeId();
  }
  updateSettings({ remoteNodeId: nodeId, remoteAgentInstalledAt: new Date().toISOString() });
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  return getRemoteAgentStatus();
}

export async function uninstallAgent(): Promise<RemoteAgentStatus> {
  if (!agentInstalled()) return getRemoteAgentStatus();
  await runElevated(AGENT_EXE, ['-fulluninstall']);
  updateSettings({ remoteNodeId: null, remoteAgentInstalledAt: null });
  return getRemoteAgentStatus();
}

function runElevated(exe: string, args: string[]): Promise<void> {
  // PowerShell Start-Process -Verb RunAs triggers UAC and waits for exit.
  const psArgs = [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$p = Start-Process -FilePath '${exe.replace(/'/g, "''")}' -ArgumentList '${args.join(' ')}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', psArgs, { windowsHide: true, stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(code === 1223 ? 'Installation was cancelled at the Windows prompt.' : `Installer exited with code ${code}`));
    });
  });
}
