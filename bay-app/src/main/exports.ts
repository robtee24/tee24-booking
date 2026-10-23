import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import log from 'electron-log';
import { getSettings } from './store';
import { request } from './api';

/**
 * GSPro shot data → Tee24.
 *
 * GSPro's Practice Range / On-Course Practice "clipboard → Export CSV" writes a
 * CSV to the Windows Desktop and keeps no history of its own. The kiosk scans
 * the usual drop folders for fresh CSVs, lets the player pick which ones to
 * send, and ships them to the server (which parks them for the member app and
 * / or emails them). Files are never deleted from the PC here.
 */

export interface FoundCsv {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  /** Rough shot count (data rows), null if the file doesn't look like shot data */
  shots: number | null;
  /** Clubs seen in the first rows, for the picker */
  clubs: string[];
  looksLikeGspro: boolean;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const LOOKBACK_MS = 36 * 60 * 60 * 1000;

function candidateDirs(): string[] {
  const home = os.homedir();
  const dirs = new Set<string>([
    app.getPath('desktop'),
    path.join(home, 'Desktop'),
    path.join(home, 'OneDrive', 'Desktop'),
    app.getPath('documents'),
    path.join(home, 'Documents', 'GSPro'),
    path.join(home, 'OneDrive', 'Documents'),
    app.getPath('downloads'),
  ]);
  // Public desktop (shared kiosk accounts sometimes land here)
  if (process.env.PUBLIC) dirs.add(path.join(process.env.PUBLIC, 'Desktop'));
  // GSPro install folder, in case a build writes next to the exe
  const gs = getSettings().gsproPath;
  if (gs) {
    dirs.add(path.dirname(gs));
    dirs.add(path.join(path.dirname(gs), 'Exports'));
  }
  return [...dirs].filter((d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

const SHOT_HEADERS = ['club', 'ball speed', 'ballspeed', 'carry', 'launch angle', 'back spin', 'backspin', 'club speed', 'smash', 'total', 'offline', 'spin axis'];

function sniff(file: string): { shots: number | null; clubs: string[]; looksLikeGspro: boolean } {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const head = buf.subarray(0, n).toString('utf8');
    const lines = head.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { shots: null, clubs: [], looksLikeGspro: false };
    const headerLine = lines[0].toLowerCase();
    const hits = SHOT_HEADERS.filter((h) => headerLine.includes(h)).length;
    const looksLikeGspro = hits >= 3;
    if (!looksLikeGspro) return { shots: null, clubs: [], looksLikeGspro: false };
    const delim = headerLine.includes('\t') ? '\t' : headerLine.split(';').length > headerLine.split(',').length ? ';' : ',';
    const headers = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const clubIdx = headers.findIndex((h) => h === 'club' || h === 'club name' || h === 'clubname' || h === 'club type');
    const clubs = new Set<string>();
    if (clubIdx >= 0) {
      for (const l of lines.slice(1, 200)) {
        const c = (l.split(delim)[clubIdx] ?? '').trim().replace(/^"|"$/g, '');
        if (c && !/^(avg|average|mean|std|total)/i.test(c)) clubs.add(c);
      }
    }
    // Full count needs the whole file when it's bigger than our sniff window.
    let shots = lines.length - 1;
    if (n >= buf.length) {
      const all = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
      shots = Math.max(0, all.length - 1);
    }
    // GSPro appends an "Average" row at the bottom of its table.
    const last = lines[lines.length - 1].toLowerCase();
    if (/^(avg|average|mean)/.test(last)) shots = Math.max(0, shots - 1);
    return { shots, clubs: [...clubs].slice(0, 6), looksLikeGspro };
  } catch {
    return { shots: null, clubs: [], looksLikeGspro: false };
  }
}

/** Recent CSVs that look like launch-monitor shot data, newest first. */
export function findRecentCsvs(opts: { sinceMs?: number } = {}): { files: FoundCsv[]; scanned: string[] } {
  const since = Date.now() - (opts.sinceMs ?? LOOKBACK_MS);
  const dirs = candidateDirs();
  const out: FoundCsv[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !/\.csv$/i.test(e.name)) continue;
      const full = path.join(dir, e.name);
      const key = full.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.size === 0 || st.size > MAX_FILE_BYTES || st.mtimeMs < since) continue;
      const s = sniff(full);
      if (!s.looksLikeGspro) continue;
      out.push({ path: full, name: e.name, size: st.size, modifiedAt: st.mtime.toISOString(), shots: s.shots, clubs: s.clubs, looksLikeGspro: true });
    }
  }
  out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return { files: out.slice(0, 12), scanned: dirs };
}

export interface ExportResult {
  ok: true;
  exports: { id: string; fileName: string; shotCount: number; topClubs: string[] }[];
  member: { id: string; firstName: string | null } | null;
  matched: boolean;
  emailedTo: string | null;
  pendingForApp: boolean;
}

/** Read the chosen files and send them to the server. Paths must come from findRecentCsvs(). */
export async function sendExports(input: { paths: string[]; delivery: 'APP' | 'EMAIL' | 'BOTH'; bookingId?: string | null; phone?: string | null; email?: string | null }) {
  const known = new Set(findRecentCsvs({ sinceMs: LOOKBACK_MS * 4 }).files.map((f) => f.path.toLowerCase()));
  const files = input.paths
    .filter((p) => known.has(p.toLowerCase()))
    .slice(0, 6)
    .map((p) => ({ name: path.basename(p), content: fs.readFileSync(p, 'utf8') }));
  if (!files.length) throw new Error('Pick at least one shot-data file to send.');
  const s = getSettings();
  log.info(`[exports] sending ${files.length} file(s) via ${input.delivery}`);
  return request<ExportResult>(
    'POST',
    '/api/bay-app/export',
    { deviceId: s.deviceId, delivery: input.delivery, bookingId: input.bookingId ?? null, phone: input.phone ?? null, email: input.email ?? null, files },
    null,
    45000,
  );
}
