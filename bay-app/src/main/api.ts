import { app } from 'electron';
import os from 'os';
import { apiBaseUrl, getSettings } from './store';

/**
 * Thin HTTP client for reservations.tee24.golf/api/bay-app/*.
 * All calls run in the main process so the renderer never holds tokens.
 */

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: unknown;
  constructor(status: number, message: string, code?: string, data?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  token?: string | null,
  timeoutMs = 15000,
): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `Tee24BayKiosk/${app.getVersion()} (${os.hostname()})`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!res.ok) {
      const d = (data ?? {}) as { error?: string; code?: string };
      throw new ApiError(res.status, d.error || `Request failed (${res.status})`, d.code, data);
    }
    return data as T;
  } finally {
    clearTimeout(t);
  }
}

// ---------- Types mirrored from the server ----------

export interface BookingPlayers {
  /** Member + guests allowed on this bay; null = not enforced (non-member booking) */
  allowedPlayers: number | null;
  includedGuests: number;
  bookedGuests: number;
  companions: { firstName: string; lastInitial: string; includedGuests: number }[];
  unauthorizedGuestFeeCents: number;
}

export interface Booking {
  id: string;
  firstName: string;
  lastInitial: string;
  start: string;
  end: string;
  checkedInAt?: string | null;
  players?: BookingPlayers | null;
}

export interface PlayerAllowance {
  bookingId: string;
  allowedPlayers: number | null;
  booker: { memberId: string | null; firstName: string; lastInitial: string; includedGuests: number; bookedGuests: number };
  companions: { memberId: string; firstName: string; lastInitial: string; includedGuests: number }[];
  unauthorizedGuestFeeCents: number;
  added?: { firstName: string; lastInitial: string; includedGuests: number };
}

export interface StatusResponse {
  serverNow: string;
  remote: { provider: 'meshcentral'; serverUrl: string; agentUrl: string | null } | null;
  remoteNodeId: string | null;
  location: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    /** Front-desk / support number shown in Setup Help (location.phone); null until an admin sets it. */
    phone?: string | null;
    bayAppEnabled: boolean;
    bayAppUnlockMinutes: number;
    bayAppWarningMinutes: number;
    bayAppAutoCancelOnTimeout: boolean;
    passAccessUrl: string | null;
  };
  bay: {
    id: string | null;
    number: number;
    name: string | null;
    launchMonitor: string;
    setupNotes: string | null;
    disabled: boolean;
  };
  currentBooking: Booking | null;
  nextBooking: Booking | null;
}

export interface AdminLocation {
  id: string;
  name: string;
  slug: string;
  bayAppEnabled: boolean;
  bays: { id: string; number: number; name: string | null; launchMonitor: string; setupNotes: string | null }[];
  bayAppRegistrations: { bayNumber: number; deviceId: string; hostname: string | null; lastSeenAt: string | null }[];
}

export interface AdminSession {
  ok: true;
  token: string;
  admin: { id: string; name: string | null; role: string };
  locations: AdminLocation[];
}

// ---------- Public (device) endpoints ----------

export function getStatus(opts: { nodeId?: string | null } = {}) {
  const s = getSettings();
  const q = new URLSearchParams({ deviceId: s.deviceId, v: app.getVersion() });
  if (opts.nodeId) q.set('nodeId', opts.nodeId);
  return request<StatusResponse>('GET', `/api/bay-app/status?${q}`, undefined, null, 12000);
}

export function getSchedule(dateISO?: string) {
  const s = getSettings();
  const q = new URLSearchParams({ deviceId: s.deviceId });
  if (dateISO) q.set('date', dateISO);
  return request<unknown>('GET', `/api/bay-app/schedule?${q}`);
}

export function getHelp() {
  const s = getSettings();
  const q = new URLSearchParams();
  if (s.locationId) q.set('deviceId', s.deviceId);
  return request<unknown>('GET', `/api/bay-app/help?${q}`);
}

export function checkIn(bookingId: string, phone: string) {
  const s = getSettings();
  return request<{ ok: boolean; alreadyCheckedIn?: boolean }>('POST', '/api/bay-app/check-in', {
    deviceId: s.deviceId,
    bookingId,
    phone,
  });
}

export function cancelTimeout(bookingId: string) {
  const s = getSettings();
  return request<{ ok: boolean; canceled?: boolean }>('POST', '/api/bay-app/cancel-timeout', {
    deviceId: s.deviceId,
    bookingId,
  });
}

// ---------- Players / unauthorized guests ----------

export function addCompanionMember(bookingId: string, phone: string) {
  const s = getSettings();
  return request<PlayerAllowance>('POST', '/api/bay-app/players', { deviceId: s.deviceId, bookingId, action: 'add-member', phone });
}

/**
 * Too-many-players event → admin alert. `action` is what the player chose:
 * PROCEEDED (accepted the per-guest charge) or EXITED (left the game instead).
 */
export function createGuestViolation(body: {
  bookingId: string | null;
  screen: 'SETUP' | 'ROUND';
  action: 'PROCEEDED' | 'EXITED';
  playerCount: number;
  allowedPlayers: number;
}) {
  const s = getSettings();
  return request<{ id: string; extraGuests: number; feeCents: number; acknowledgedAt: string }>('POST', '/api/bay-app/guest-violation', { deviceId: s.deviceId, ...body });
}

// ---------- Admin (Quo SMS) endpoints ----------

export function adminSendOtp(phone: string) {
  return request<{ ok: boolean }>('POST', '/api/bay-app/auth', { action: 'send-otp', phone });
}

export function adminVerifyOtp(phone: string, code: string) {
  return request<AdminSession>('POST', '/api/bay-app/auth', { action: 'verify-otp', phone, code });
}

export function adminRefresh(token: string) {
  return request<AdminSession>('GET', '/api/bay-app/auth', undefined, token);
}

export function adminRegister(
  token: string,
  body: { locationId: string; bayNumber: number; force?: boolean },
) {
  const s = getSettings();
  return request<{
    ok: boolean;
    registration: { deviceId: string; bayNumber: number };
    location: { id: string; name: string; slug: string };
    bay: { id: string; number: number; name: string | null; launchMonitor: string } | null;
  }>('POST', '/api/bay-app/register', {
    ...body,
    deviceId: s.deviceId,
    hostname: os.hostname(),
    appVersion: app.getVersion(),
  }, token);
}

export function adminUnregister(token: string) {
  const s = getSettings();
  return request<{ ok: boolean }>('DELETE', `/api/bay-app/unregister?deviceId=${encodeURIComponent(s.deviceId)}`, undefined, token);
}

export function adminGetBaySettings(token: string) {
  const s = getSettings();
  return request<unknown>('GET', `/api/bay-app/bay-settings?deviceId=${encodeURIComponent(s.deviceId)}`, undefined, token);
}

export function adminPatchBaySettings(
  token: string,
  patch: { name?: string | null; launchMonitor?: string; setupNotes?: string | null },
) {
  const s = getSettings();
  return request<{ ok: boolean; bay: { id: string; number: number; name: string | null; launchMonitor: string; setupNotes: string | null } }>(
    'PATCH',
    '/api/bay-app/bay-settings',
    { deviceId: s.deviceId, ...patch },
    token,
  );
}
