import { useEffect, useState } from 'react';
import type { KioskBridge, KioskState, IpcError } from './types';

declare global {
  interface Window {
    kiosk: KioskBridge;
  }
}

export const kiosk = window.kiosk;

export function isErr(r: unknown): r is IpcError {
  return !!r && typeof r === 'object' && 'error' in (r as Record<string, unknown>) && typeof (r as IpcError).error === 'string';
}

/** Live kiosk state pushed from main. */
export function useKioskState(): KioskState | null {
  const [state, setState] = useState<KioskState | null>(null);
  useEffect(() => {
    let alive = true;
    kiosk.getState().then((s) => alive && setState(s as KioskState));
    const off = kiosk.onState((s) => alive && setState(s as KioskState));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

/** Ticks every second; returns server-time "now" in ms. */
export function useServerNow(offsetMs: number): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    setNow(Date.now() + offsetMs);
    const t = setInterval(() => setNow(Date.now() + offsetMs), 1000);
    return () => clearInterval(t);
  }, [offsetMs]);
  return now;
}

export function formatCountdown(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatTime(iso: string, tz?: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  } catch {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

export function formatPhoneInput(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
