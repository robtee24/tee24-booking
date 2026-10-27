import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export const DEFAULT_API_BASE_URL = 'https://reservations.tee24.golf';

/**
 * GolfIn IDRA II. The GolfIn Launcher's "IDRA" tile starts IDRAMonitor.exe, which
 * itself starts GSPro.exe and IDRA.exe (the connector that lights the IDRA badge
 * in GSPro). The version folder changes with each IDRA update, so resolve it.
 */
const IDRA_ROOT = 'C:\\Program Files\\Sim Sports Corporation\\IDRA';
const IDRA_EXE = 'IDRAMonitor.exe';
/** Path the pre-1.2 builds shipped; wrong vendor, never existed on a bay PC. */
const LEGACY_IDRA_PATH = 'C:\\Program Files\\Uneekor\\Uneekor View\\View.exe';

export function findIdraMonitor(): string | null {
  let dirs: string[];
  try {
    dirs = fs.readdirSync(IDRA_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return null;
  }
  const numeric = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const candidates = dirs
    .filter((d) => /^\d+(\.\d+)*$/.test(d) && fs.existsSync(path.join(IDRA_ROOT, d, IDRA_EXE)))
    .sort((a, b) => {
      const x = numeric(a), y = numeric(b);
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const diff = (y[i] ?? 0) - (x[i] ?? 0);
        if (diff) return diff;
      }
      return 0;
    });
  return candidates.length ? path.join(IDRA_ROOT, candidates[0], IDRA_EXE) : null;
}

/** True when this launch-monitor program starts GSPro itself (so Play must not start GSPro too). */
export function launchMonitorStartsGspro(exe: string): boolean {
  return path.basename(exe).toLowerCase() === IDRA_EXE.toLowerCase();
}

export const DEFAULT_LAUNCH_MONITOR_PATHS: Record<string, string> = {
  IDRA: path.join(IDRA_ROOT, '8.2.6', IDRA_EXE),
  SKYTRAK: 'C:\\Program Files\\SkyTrak\\SkyTrak.exe',
  PROTEE_VX: 'C:\\Program Files\\ProTee United\\ProTee VX\\ProTeeVX.exe',
  OTHER: '',
};

export function defaultLaunchMonitorPath(lm: string | null | undefined): string {
  if (!lm) return '';
  if (lm === 'IDRA') return findIdraMonitor() ?? DEFAULT_LAUNCH_MONITOR_PATHS.IDRA;
  return DEFAULT_LAUNCH_MONITOR_PATHS[lm] ?? '';
}

export const DEFAULT_GSPRO_PATH = 'C:\\GSProV1\\Core\\GSP\\GSPro.exe';

export interface KioskSettings {
  deviceId: string;
  apiBaseUrl: string;
  /** Registration (one bay per computer) */
  locationId: string | null;
  locationName: string | null;
  locationSlug: string | null;
  bayId: string | null;
  bayNumber: number | null;
  bayName: string | null;
  launchMonitor: string | null;
  /** Launch paths */
  launchMonitorPath: string;
  gsproPath: string;
  /** Remote support (MeshCentral agent) */
  remoteNodeId: string | null;
  remoteAgentInstalledAt: string | null;
  /** Behaviour */
  openAtLogin: boolean;
  /** Exe path the Windows logon task was last registered with (null = not registered) */
  autostartTaskExe: string | null;
  /** Set once the first-run wizard has been completed */
  setupCompletedAt: string | null;
}

const DEFAULTS: KioskSettings = {
  deviceId: '',
  apiBaseUrl: DEFAULT_API_BASE_URL,
  locationId: null,
  locationName: null,
  locationSlug: null,
  bayId: null,
  bayNumber: null,
  bayName: null,
  launchMonitor: null,
  launchMonitorPath: '',
  gsproPath: DEFAULT_GSPRO_PATH,
  remoteNodeId: null,
  remoteAgentInstalledAt: null,
  openAtLogin: true,
  autostartTaskExe: null,
  setupCompletedAt: null,
};

/**
 * Tiny JSON settings store in the Electron userData folder. Kept dependency-free
 * so the CommonJS main process never fights ESM-only packages.
 */
let cache: KioskSettings | null = null;

function filePath(): string {
  return path.join(app.getPath('userData'), 'tee24-bay-kiosk.json');
}

function load(): KioskSettings {
  if (cache) return cache;
  let data: Partial<KioskSettings> = {};
  try {
    data = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
  } catch {
    data = {};
  }
  cache = { ...DEFAULTS, ...data };
  if (!cache.deviceId) {
    cache.deviceId = randomUUID();
    persist();
  }
  return cache;
}

function persist() {
  if (!cache) return;
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, p);
}

export function getSettings(): KioskSettings {
  return { ...load() };
}

export function updateSettings(patch: Partial<KioskSettings>): KioskSettings {
  const s = load();
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    (s as unknown as Record<string, unknown>)[k] = v;
  }
  persist();
  return { ...s };
}

export function isRegistered(): boolean {
  const s = load();
  return !!(s.locationId && s.bayNumber);
}

export function clearRegistration(): KioskSettings {
  return updateSettings({
    locationId: null,
    locationName: null,
    locationSlug: null,
    bayId: null,
    bayNumber: null,
    bayName: null,
    launchMonitor: null,
    setupCompletedAt: null,
  });
}

/**
 * One-time fix-ups for settings written by older builds. Returns a description
 * of what changed (for the log) or null.
 */
export function migrateSettings(): string | null {
  const s = load();
  if (s.launchMonitor !== 'IDRA') return null;
  const stale = !s.launchMonitorPath || s.launchMonitorPath === LEGACY_IDRA_PATH || !fs.existsSync(s.launchMonitorPath);
  if (!stale) return null;
  const found = findIdraMonitor();
  if (!found || found === s.launchMonitorPath) return null;
  const before = s.launchMonitorPath || '(blank)'; // `s` is the live cache; read before updating
  updateSettings({ launchMonitorPath: found });
  return `launchMonitorPath ${before} → ${found}`;
}

export function apiBaseUrl(): string {
  return (load().apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}
