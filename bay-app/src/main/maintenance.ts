import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { getSettings, updateSettings } from './store';

/**
 * Weekly course cleanup.
 *
 * Players download GSPro courses all week and the bay PC's drive fills up.
 * Once a week — at the first inactivity close after Monday 00:01 local time —
 * the kiosk deletes everything in the Courses folder except the house courses,
 * then restarts Windows. GSPro is already closed when this runs (the idle
 * close finished first), so nothing has the files open.
 */

export const COURSES_DIR = 'C:\\GSProV1\\Core\\GSP\\Courses';

/** Folder names kept through the wipe (case-insensitive). */
export const KEEP_COURSES = ['Bootleggers_GSP', 'gsp_practicearea', 'multi_range_gsp'];

/** Most recent Monday 00:01 local time at or before `now`. */
export function lastWeeklyBoundary(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 1, 0, 0);
  const sinceMonday = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - sinceMonday);
  if (d > now) d.setDate(d.getDate() - 7); // it is Monday but before 00:01
  return d;
}

/** True when this week's cleanup has not run yet. */
export function courseWipeDue(now = new Date()): boolean {
  const s = getSettings();
  if (!s.weeklyCourseWipe) return false;
  const boundary = lastWeeklyBoundary(now);
  const last = s.lastCourseWipeAt ? new Date(s.lastCourseWipeAt) : null;
  return !last || last < boundary;
}

export type WipeResult = { removed: string[]; kept: string[]; failed: string[]; freedBytes: number };

function dirSize(p: string): number {
  let total = 0;
  try {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) total += dirSize(f);
      else if (e.isFile()) total += fs.statSync(f).size;
    }
  } catch {
    /* ignore */
  }
  return total;
}

/** Delete everything in the Courses folder except KEEP_COURSES. Records the run in settings. */
export function wipeCourses(reason: string): WipeResult {
  const keep = new Set(KEEP_COURSES.map((n) => n.toLowerCase()));
  const result: WipeResult = { removed: [], kept: [], failed: [], freedBytes: 0 };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(COURSES_DIR, { withFileTypes: true });
  } catch (e) {
    log.warn(`[courses] cannot read ${COURSES_DIR}: ${e instanceof Error ? e.message : e}`);
    updateSettings({ lastCourseWipeAt: new Date().toISOString() });
    return result;
  }
  for (const e of entries) {
    if (keep.has(e.name.toLowerCase())) {
      result.kept.push(e.name);
      continue;
    }
    const full = path.join(COURSES_DIR, e.name);
    const size = e.isDirectory() ? dirSize(full) : (() => { try { return fs.statSync(full).size; } catch { return 0; } })();
    try {
      fs.rmSync(full, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      result.removed.push(e.name);
      result.freedBytes += size;
    } catch (err) {
      result.failed.push(e.name);
      log.warn(`[courses] could not remove ${e.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  updateSettings({ lastCourseWipeAt: new Date().toISOString() });
  const freed = result.freedBytes >= 1024 ** 3 ? `${(result.freedBytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(result.freedBytes / 1024 ** 2)} MB`;
  log.info(`[courses] weekly cleanup (${reason}): removed ${result.removed.length} (${freed}), kept ${result.kept.join(', ') || 'none'}${result.failed.length ? `, failed ${result.failed.join(', ')}` : ''}`);
  return result;
}
