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
    /** Server-side switch; when false the status carries no player allowance and the kiosk never shows the players modal. */
    bayAppGuestEnforcement?: boolean;
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

// ---------- League ----------

export interface LeagueSettings {
  gimmeDistanceFt: number;
  mulligans: boolean;
  greenSpeed: string;
  teeRules: unknown;
  minorAge: number;
  openingWeeks: number;
  handicapCap: number;
  throwOutEvery: number;
  pointsTop5: number;
  pointsTop10: number;
  pointsTop15: number;
  pointsTeamWin: number;
  pointsTeamTie: number;
  firstPlacePct: number;
  firstPlaceCapCents: number;
  secondPlacePct: number;
  secondPlaceCapCents: number;
  championshipTopPct: number;
}

export interface LeagueInfo {
  id: string;
  name: string;
  locationName: string;
  timezone: string;
  weeklyFeeCents: number;
  playerCount: number;
  settings: LeagueSettings;
  rulesUrl: string;
  tutorialSteps: { title: string; body: string }[];
  championshipAt: string | null;
  championshipPotCents: number;
  week: LeagueWeekInfo | null;
  /** Every week of the season; players may submit for any week before its deadline (play ahead). */
  weeks?: LeagueWeekInfo[];
}

export interface LeagueWeekInfo {
  id: string;
  weekNumber: number;
  courseName: string | null;
  opensAt: string;
  deadlineAt: string;
  deadlineLabel: string;
  isOpen: boolean;
  potCents: number;
  submittedCount: number;
  /** Course not announced yet: shown, but can't be submitted for. */
  courseTba?: boolean;
  /** Before its deadline, not finalized, course announced. */
  submittable?: boolean;
  /** The week that runs this calendar week. */
  isCurrent?: boolean;
}

export interface LeagueLookup {
  member: { id: string; firstName: string; lastName: string; lastInitial: string };
  inLeague: boolean;
  player: { id: string; displayName: string | null; isMinor: boolean; winningsEligible: boolean } | null;
  isMinor: boolean;
  hasCard: boolean;
  card: { last4: string | null; brand: string | null } | null;
  feeCents: number;
  /** Free (minor / $0 fee) or has a card on file — i.e. the submission won't be rejected for payment. */
  canPay: boolean;
  /** Already has a non-rejected score for the week that was looked up. */
  alreadySubmitted: boolean;
  weekNumber: number | null;
}

/** Pre-flight read of the screen: is a scorecard up, who is on it, do the settings pass. */
export interface LeagueCheckResult {
  isScorecard: boolean;
  cardNames: string[];
  settings: { mulligans: boolean | null; gimmeFt: number | null; greens: string | null };
  /** Course of the chosen week vs. the course name read off the screen. */
  course?: { expected: string | null; found: boolean };
  ok: boolean;
  hard: string[];
  soft: string[];
  warnings: string[];
}

export type LeagueResultCode =
  | 'CARD_REJECTED'
  | 'DUPLICATE_PHONE'
  | 'ALREADY_SUBMITTED'
  | 'NAME_NOT_ON_CARD'
  | 'PAYMENT_REQUIRED'
  | 'MEMBER_NOT_FOUND'
  | 'WEEK_CLOSED'
  | string;

export interface LeagueSubmitResult {
  ok: boolean;
  weekNumber: number;
  rejected: boolean;
  rejectReasons: string[];
  warnings: string[];
  cardNames: string[];
  results: {
    phone: string;
    name: string;
    status: 'ACCEPTED' | 'FAILED';
    code?: LeagueResultCode;
    message: string;
    gross?: number;
    front9?: number;
    back9?: number;
    entry?: string;
    feeCents?: number;
    joined?: boolean;
    isMinor?: boolean;
  }[];
}

export type OcrPayload = { w: number; h: number; lines: { text: string; x: number; y: number; w: number; h: number }[] };

export function getLeagues() {
  const s = getSettings();
  return request<{ leagues: LeagueInfo[] }>('GET', `/api/bay-app/league?deviceId=${encodeURIComponent(s.deviceId)}`);
}

export function leagueLookup(leagueId: string, phone: string, weekId?: string | null) {
  const s = getSettings();
  return request<LeagueLookup>('POST', '/api/bay-app/league', { deviceId: s.deviceId, action: 'lookup', leagueId, phone, weekId: weekId ?? null });
}

export function leagueCheck(leagueId: string, weekId: string | null, ocr: OcrPayload) {
  const s = getSettings();
  return request<LeagueCheckResult>('POST', '/api/bay-app/league', { deviceId: s.deviceId, action: 'check', leagueId, weekId, ocr }, null, 30_000);
}

export function leagueJoin(leagueId: string, phone: string, displayName?: string | null) {
  const s = getSettings();
  return request<LeagueLookup & { created: boolean }>('POST', '/api/bay-app/league', { deviceId: s.deviceId, action: 'join', leagueId, phone, displayName: displayName ?? null });
}

export function leagueSubmit(body: {
  leagueId: string;
  weekId: string | null;
  imageBase64: string;
  imageMime: string;
  ocr: OcrPayload;
  entries: { phone: string; name: string }[];
}) {
  const s = getSettings();
  // Up to 5 Square charges + OCR parsing: allow a generous timeout.
  return request<LeagueSubmitResult>('POST', '/api/bay-app/league', { deviceId: s.deviceId, action: 'submit', ...body }, null, 60_000);
}

// ---------- Admin endpoints ----------

/** Phone-number sign-in (no text code). Only numbers on the admin list get a token. */
export function adminSignIn(phone: string) {
  return request<AdminSession>('POST', '/api/bay-app/auth', { action: 'sign-in', phone });
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
