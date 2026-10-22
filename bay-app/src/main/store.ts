import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export const DEFAULT_API_BASE_URL = 'https://reservations.tee24.golf';

export const DEFAULT_LAUNCH_MONITOR_PATHS: Record<string, string> = {
  IDRA: 'C:\\Program Files\\Uneekor\\Uneekor View\\View.exe',
  SKYTRAK: 'C:\\Program Files\\SkyTrak\\SkyTrak.exe',
  PROTEE_VX: 'C:\\Program Files\\ProTee United\\ProTee VX\\ProTeeVX.exe',
  OTHER: '',
};
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

export function apiBaseUrl(): string {
  return (load().apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}
