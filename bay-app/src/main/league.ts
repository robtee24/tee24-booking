import log from 'electron-log';
import * as api from './api';
import * as windows from './windows';
import * as screenWatch from './screen';

/**
 * League scorecard submission from the bay.
 *
 * The player finishes 18 holes, brings up GSPro's scorecard, and opens the
 * League flow from the toolbar. On Submit we hide every kiosk window for a
 * moment so the screenshot shows GSPro (not our modal), capture + OCR the
 * screen, then post the image, OCR lines and the players' phone/name pairs to
 * the server. The server parses the card, verifies settings (mulligans off,
 * gimmes), attributes rows to members, saves and charges.
 */

let cachedLeagues: { at: number; leagues: api.LeagueInfo[] } | null = null;

export async function getLeagues(force = false): Promise<api.LeagueInfo[]> {
  if (!force && cachedLeagues && Date.now() - cachedLeagues.at < 60_000) return cachedLeagues.leagues;
  const r = await api.getLeagues();
  cachedLeagues = { at: Date.now(), leagues: r.leagues };
  return r.leagues;
}

export function invalidate() {
  cachedLeagues = null;
}

export type CaptureResult = { ok: true; w: number; h: number; lines: screenWatch.OcrLine[]; png: string; ms: number } | { ok: false; error: string };

/** Hide our windows, capture GSPro, bring the overlay back. */
export async function captureScorecard(): Promise<CaptureResult> {
  const overlayWasVisible = windows.isOverlayVisible();
  const toolbarWasVisible = windows.isToolbarVisible();
  try {
    windows.hideOverlay();
    windows.hideToolbar();
    // Give the compositor a moment to actually remove the windows.
    await new Promise((r) => setTimeout(r, 450));
    const r = await screenWatch.captureOnce();
    if (!r.ok) {
      log.warn(`[league] capture failed: ${r.error}`);
      return r;
    }
    log.info(`[league] captured scorecard ${r.w}x${r.h} (${r.lines.length} lines, ${Math.round(r.png.length / 1024)} KB, ${r.ms} ms)`);
    return { ok: true, w: r.w, h: r.h, lines: r.lines, png: r.png, ms: r.ms };
  } finally {
    if (toolbarWasVisible) windows.showToolbar();
    if (overlayWasVisible) windows.showOverlay();
  }
}

export type CheckResult = api.LeagueCheckResult | { ok: false; isScorecard: false; cardNames: []; settings: { mulligans: null; gimmeFt: null; greens: null }; hard: string[]; soft: []; warnings: [] };

/**
 * Pre-flight before the confirm step: capture + OCR the screen and ask the
 * server whether a scorecard is up and the settings pass. Nothing is saved
 * or charged. Lets the player fix GSPro before anyone is billed.
 */
export async function check(leagueId: string, weekId: string | null): Promise<CheckResult> {
  const cap = await captureScorecard();
  if (!cap.ok) {
    return { ok: false, isScorecard: false, cardNames: [], settings: { mulligans: null, gimmeFt: null, greens: null }, hard: [`We couldn't read the screen (${cap.error}).`], soft: [], warnings: [] };
  }
  const r = await api.leagueCheck(leagueId, weekId, { w: cap.w, h: cap.h, lines: cap.lines });
  log.info(`[league] check: scorecard=${r.isScorecard} names=[${r.cardNames.join(', ')}] course=${r.course ? `${r.course.expected}:${r.course.found}` : '-'} ok=${r.ok}${r.hard.length ? ` HARD ${r.hard.join(' | ')}` : ''}`);
  return r;
}

export async function submit(input: { leagueId: string; weekId: string | null; entries: { phone: string; name: string }[] }): Promise<api.LeagueSubmitResult> {
  const cap = await captureScorecard();
  if (!cap.ok) {
    return {
      ok: false,
      weekNumber: 0,
      rejected: true,
      rejectReasons: [`We couldn't read the screen (${cap.error}). Please see the front desk.`],
      warnings: [],
      cardNames: [],
      results: input.entries.map((e) => ({ ...e, status: 'FAILED' as const, message: 'Screen capture failed' })),
    };
  }
  const r = await api.leagueSubmit({
    leagueId: input.leagueId,
    weekId: input.weekId,
    imageBase64: cap.png,
    imageMime: 'image/png',
    ocr: { w: cap.w, h: cap.h, lines: cap.lines },
    entries: input.entries,
  });
  invalidate();
  log.info(`[league] submit week ${r.weekNumber}: ${r.results.map((x) => `${x.name}=${x.status}`).join(', ')}${r.rejected ? ` REJECTED ${r.rejectReasons.join(' | ')}` : ''}`);
  return r;
}
