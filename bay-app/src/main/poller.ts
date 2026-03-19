import { net } from 'electron';
import { getConfig } from './store';
import { showOverlay, hideOverlay, showWarning, hideWarning } from './windows';

const POLL_INTERVAL_NORMAL = 30_000;
const POLL_INTERVAL_ACTIVE = 10_000;

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isPolling = false;
let currentOverlayBookingId: string | null = null;
let currentWarningBookingId: string | null = null;

export interface BayStatus {
  location: {
    name: string;
    timezone: string;
    bayAppEnabled: boolean;
    bayAppUnlockMinutes: number;
    bayAppWarningMinutes: number;
    bayAppAutoCancelOnTimeout: boolean;
  };
  bay: { number: number; name: string | null };
  currentBooking: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    start: string;
    end: string;
    checkedInAt: string | null;
  } | null;
  nextBooking: {
    id: string;
    firstName: string;
    lastName: string;
    start: string;
    end: string;
  } | null;
}

function apiGet(baseUrl: string, path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `${baseUrl}${path}`;
    const request = net.request(url);
    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`Invalid JSON from ${url}`));
        }
      });
    });
    request.on('error', (err) => reject(err));
    request.end();
  });
}

async function poll(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  try {
    const config = getConfig();
    if (!config.configured || !config.apiBaseUrl || !config.deviceId) return;

    const status: BayStatus = await apiGet(
      config.apiBaseUrl,
      `/api/bay-app/status?deviceId=${encodeURIComponent(config.deviceId)}`
    );

    if (!status.location?.bayAppEnabled) {
      hideOverlay();
      hideWarning();
      currentOverlayBookingId = null;
      currentWarningBookingId = null;
      return;
    }

    const now = Date.now();

    if (status.currentBooking && !status.currentBooking.checkedInAt) {
      const bookingStart = new Date(status.currentBooking.start).getTime();
      if (now >= bookingStart) {
        if (currentOverlayBookingId !== status.currentBooking.id) {
          currentOverlayBookingId = status.currentBooking.id;
          hideWarning();
          currentWarningBookingId = null;
          showOverlay(status);
        }
      }
    } else {
      if (currentOverlayBookingId) {
        currentOverlayBookingId = null;
        hideOverlay();
      }
    }

    if (status.nextBooking) {
      const nextStart = new Date(status.nextBooking.start).getTime();
      const minutesUntil = (nextStart - now) / 60_000;
      if (minutesUntil <= status.location.bayAppWarningMinutes && minutesUntil > 0) {
        if (currentWarningBookingId !== status.nextBooking.id) {
          currentWarningBookingId = status.nextBooking.id;
          showWarning(status);
        }
      } else {
        if (currentWarningBookingId) {
          currentWarningBookingId = null;
          hideWarning();
        }
      }
    } else {
      if (currentWarningBookingId) {
        currentWarningBookingId = null;
        hideWarning();
      }
    }

    const hasActiveState = !!currentOverlayBookingId || !!currentWarningBookingId;
    scheduleNext(hasActiveState ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_NORMAL);
  } catch (err) {
    console.error('[poller] Error:', err);
    scheduleNext(POLL_INTERVAL_NORMAL);
  } finally {
    isPolling = false;
  }
}

function scheduleNext(interval: number): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, interval);
}

export function startPolling(): void {
  console.log('[poller] Starting polling...');
  poll();
}

export function stopPolling(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  currentOverlayBookingId = null;
  currentWarningBookingId = null;
}

export function notifyCheckInComplete(): void {
  currentOverlayBookingId = null;
  hideOverlay();
  poll();
}

export function notifyCancelComplete(): void {
  currentOverlayBookingId = null;
  hideOverlay();
  poll();
}
