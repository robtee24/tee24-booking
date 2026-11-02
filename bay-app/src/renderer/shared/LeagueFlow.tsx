import { useEffect, useState } from 'react';
import { kiosk, isErr, formatPhoneInput } from './bridge';
import type { LeagueInfo, LeagueLookup, LeagueCheckResult, LeagueSubmitResult } from './types';
import { CheckIcon, CloseIcon, DeleteIcon, PhoneIcon } from './Icons';

/**
 * League on the bay kiosk. Everything league-flavoured is wrapped in
 * `.league-theme`, which re-points the kiosk CSS variables at the Tee24 app's
 * design tokens so the league looks the same on the bay as on the phone.
 *
 *  - useLeagues()          load the leagues running at this location (+ the open week)
 *  - <LeagueSettings>      the "League Settings" card (gimmes, mulligans, greens, tees)
 *  - <LeagueTutorial>      step-by-step tutorial (server-provided steps)
 *  - <LeagueRulesSummary>  three leagues / points / money / championship
 *  - <LeagueJoin>          join by phone (home screen)
 *  - <LeagueSubmitFlow>    players → read the card (pre-check) → confirm → charge + save → results
 */

export function useLeagues(force = false) {
  const [leagues, setLeagues] = useState<LeagueInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function load(f = force) {
    const r = await kiosk.leagues(f);
    if (isErr(r)) return setErr(r.error);
    setErr(null);
    setLeagues(r as LeagueInfo[]);
  }
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(true), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { leagues, err, reload: () => load(true) };
}

export const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

export function weekTitle(l: LeagueInfo): string {
  if (!l.week) return l.name;
  return `Submit your score for Week ${l.week.weekNumber}${l.week.courseName ? ` | ${l.week.courseName}` : ''}`;
}

export function championshipLabel(l: LeagueInfo): string | null {
  if (!l.championshipAt) return null;
  return new Date(l.championshipAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

type TeeRule = { label: string; maxAge: number | null; tee: string };
function teeRules(raw: unknown): TeeRule[] {
  return Array.isArray(raw) ? (raw.filter((r) => r && typeof r === 'object') as TeeRule[]) : [];
}

/* ───────────────────────── Settings ───────────────────────── */

export function LeagueSettings({ league, compact }: { league: LeagueInfo; compact?: boolean }) {
  const s = league.settings;
  const tees = teeRules(s.teeRules);
  return (
    <div className={`league-settings ${compact ? 'compact' : ''}`}>
      <div className="league-setting">
        <div className="league-setting-k">Gimmes</div>
        <div className="league-setting-v">{s.gimmeDistanceFt}&apos;</div>
        {!compact && <div className="league-setting-note">Checked on the card</div>}
      </div>
      <div className="league-setting">
        <div className="league-setting-k">Mulligans</div>
        <div className={`league-setting-v ${s.mulligans ? '' : 'warn'}`}>{s.mulligans ? 'ON' : 'OFF'}</div>
        {!compact && <div className="league-setting-note">Card is rejected if ON</div>}
      </div>
      <div className="league-setting">
        <div className="league-setting-k">Greens</div>
        <div className="league-setting-v">{s.greenSpeed}</div>
        {!compact && <div className="league-setting-note">Honor system</div>}
      </div>
      {tees.length > 0 && (
        <div className="league-setting league-setting-wide">
          <div className="league-setting-k">Tees by age · honor system</div>
          <div className="league-tees">
            {tees.map((t) => (
              <span key={t.label} className="league-tee">
                <b>{t.label}</b> {t.tee}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Tutorial ───────────────────────── */

export function LeagueTutorial({ league, compact }: { league: LeagueInfo; compact?: boolean }) {
  return (
    <ol className={`league-tutorial ${compact ? 'compact' : ''}`}>
      {league.tutorialSteps.map((s, i) => (
        <li key={i} className="league-tutorial-step">
          <div className="league-tutorial-num">{i + 1}</div>
          <div>
            <div className="league-tutorial-title">{s.title}</div>
            <div className="league-tutorial-body">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Short bullet summary of how the league works; the full text lives at league.rulesUrl. */
export function LeagueRulesSummary({ league }: { league: LeagueInfo }) {
  const s = league.settings;
  const champ = championshipLabel(league);
  return (
    <div className="league-rules-grid">
      <div className="card league-rule-card">
        <div className="card-title">Three leagues, one score</div>
        <ul className="league-rules">
          <li><b>Straight</b> — your gross score.</li>
          <li><b>Handicapped</b> — gross minus your league handicap. Weeks 1–{s.openingWeeks} play straight; after week {s.openingWeeks} closes, handicaps are applied back to those weeks and update every week after.</li>
          <li><b>Team</b> — new 2-player teams drawn every week, best-ball match play.</li>
        </ul>
      </div>
      <div className="card league-rule-card">
        <div className="card-title">Points · one leaderboard</div>
        <div className="league-kv-row">
          <Kv k="Top 5" v={`${s.pointsTop5} pts`} />
          <Kv k="Top 10" v={`${s.pointsTop10} pts`} />
          <Kv k="Top 15" v={`${s.pointsTop15} pts`} />
          <Kv k="Team win" v={`${s.pointsTeamWin} pts`} />
          <Kv k="Team tie" v={`${s.pointsTeamTie} pt`} />
        </div>
        <div className="muted league-note">Earned in both individual leagues each week. Tap any player in the Tee24 app for their scorecards, stats and winnings.</div>
      </div>
      <div className="card league-rule-card">
        <div className="card-title">Money · 100% paid out</div>
        <ul className="league-rules">
          <li><b>1st</b> — {s.firstPlacePct}% of the week&apos;s pot (up to {money(s.firstPlaceCapCents)}), split across the straight winner, handicapped winner and both players on the winning team.</li>
          <li><b>2nd</b> — {s.secondPlacePct}% (up to {money(s.secondPlaceCapCents)}), split the same way.</li>
          <li><b>The rest</b> rolls into the League Championship pot{champ ? ` — ${champ}` : ''}. Top {s.championshipTopPct}% by points qualify.</li>
          <li>Under {s.minorAge}s play free, earn points, and aren&apos;t eligible for money.</li>
        </ul>
      </div>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="league-kv">
      <div className="league-kv-k">{k}</div>
      <div className="league-kv-v">{v}</div>
    </div>
  );
}

/* ───────────────────────── Join (home) ───────────────────────── */

export function LeagueJoin({ league, onDone }: { league: LeagueInfo; onDone?: () => void }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lookup, setLookup] = useState<LeagueLookup | null>(null);
  const [joined, setJoined] = useState<LeagueLookup | null>(null);
  const digits = phone.replace(/\D/g, '');

  async function find() {
    setBusy(true);
    setErr(null);
    const r = await kiosk.leagueLookup(league.id, digits);
    setBusy(false);
    if (isErr(r)) return setErr(r.error);
    const lk = r as LeagueLookup;
    setLookup(lk);
    setName(lk.player?.displayName ?? `${lk.member.firstName} ${lk.member.lastName}`);
  }

  async function join() {
    setBusy(true);
    setErr(null);
    const r = await kiosk.leagueJoin(league.id, digits, name.trim() || null);
    setBusy(false);
    if (isErr(r)) return setErr(r.error);
    setJoined(r as LeagueLookup);
  }

  if (joined) {
    return (
      <div className="league-done">
        <div className="league-done-icon"><CheckIcon size={40} /></div>
        <h2>You&apos;re in, {joined.member.firstName}!</h2>
        <p className="muted">
          {joined.isMinor
            ? `Under ${league.settings.minorAge}: you play free and earn points, but aren't eligible for money.`
            : joined.hasCard
              ? `${money(league.weeklyFeeCents)} is charged to your card ending ${joined.card?.last4 ?? ''} each week you submit a score.`
              : `Add a card in the Tee24 app (Settings → Membership → Payment method) before you submit — the ${money(league.weeklyFeeCents)} weekly entry is charged when your score is submitted, and a score can't be accepted without it.`}
        </p>
        <p className="muted">Play this week&apos;s round, then tap <b>League</b> on the side toolbar when your scorecard is up.</p>
        {onDone && <button className="btn btn-primary btn-lg" style={{ marginTop: 20 }} onClick={onDone}>Done</button>}
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="field">
        <label>Your phone number</label>
        <div className="row">
          <input
            className="input input-xl"
            inputMode="numeric"
            autoFocus
            placeholder="(555) 555-5555"
            value={phone}
            onChange={(e) => {
              setPhone(formatPhoneInput(e.target.value));
              setLookup(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && digits.length === 10 && !lookup && void find()}
          />
          {!lookup && (
            <button className="btn btn-primary btn-lg" disabled={digits.length !== 10 || busy} onClick={find}>
              {busy ? <span className="spinner" /> : 'Find me'}
            </button>
          )}
        </div>
      </div>
      {lookup && (
        <div className="card league-member">
          <div className="row between">
            <div>
              <div className="card-title" style={{ marginBottom: 2 }}>{lookup.member.firstName} {lookup.member.lastName}</div>
              <div className="muted" style={{ fontSize: 15 }}>
                {lookup.inLeague ? 'Already in the league' : lookup.isMinor ? `Under ${league.settings.minorAge} · plays free, no money` : lookup.hasCard ? `Card on file ····${lookup.card?.last4 ?? ''}` : 'No card on file — add one in the Tee24 app before you submit'}
              </div>
            </div>
            {lookup.inLeague && <span className="badge badge-ok">Member</span>}
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label>Name as it appears on your GSPro scorecard</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rob G" />
          </div>
          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-lg" disabled={busy} onClick={join}>
              {busy ? <span className="spinner" /> : lookup.inLeague ? 'Update name' : `Join · ${lookup.isMinor ? 'free' : `${money(league.weeklyFeeCents)}/week`}`}
            </button>
          </div>
        </div>
      )}
      {err && <div className="error">{err}</div>}
    </div>
  );
}

/* ───────────────────────── Submit (overlay) ───────────────────────── */

type Entry = { phone: string; name: string; lookup: LeagueLookup | null; error: string | null; busy: boolean };
const blank = (): Entry => ({ phone: '', name: '', lookup: null, error: null, busy: false });
const digitsOf = (s: string) => s.replace(/\D/g, '');

type Stage = 'players' | 'checking' | 'confirm' | 'submitting' | 'result';

/** Case/space-insensitive "is this name on the card" check, mirroring the server's matcher loosely. */
function nameOnCard(name: string, cardNames: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(name);
  if (!n) return false;
  return cardNames.some((c) => {
    const cn = norm(c);
    return cn === n || cn.startsWith(n) || n.startsWith(cn);
  });
}

export function LeagueSubmitFlow({ league, onClose, onOpenRules }: { league: LeagueInfo; onClose: () => void; onOpenRules?: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([blank()]);
  const [stage, setStage] = useState<Stage>('players');
  const [check, setCheck] = useState<LeagueCheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<LeagueSubmitResult | null>(null);
  const week = league.week;

  function update(i: number, patch: Partial<Entry>) {
    setEntries((es) => es.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  }

  async function lookup(i: number) {
    const e = entries[i];
    const digits = digitsOf(e.phone);
    if (digits.length !== 10) return;
    update(i, { busy: true, error: null });
    const r = await kiosk.leagueLookup(league.id, digits, week?.id ?? null);
    if (isErr(r)) return update(i, { busy: false, error: r.error, lookup: null });
    const lk = r as LeagueLookup;
    update(i, { busy: false, lookup: lk, name: e.name || lk.player?.displayName || `${lk.member.firstName} ${lk.member.lastName}` });
  }

  const phoneCounts = entries.reduce<Record<string, number>>((m, e) => {
    const d = digitsOf(e.phone);
    if (d.length === 10) m[d] = (m[d] ?? 0) + 1;
    return m;
  }, {});
  const isDuplicate = (e: Entry) => (phoneCounts[digitsOf(e.phone)] ?? 0) > 1;
  const blocked = (e: Entry) => !!e.error || isDuplicate(e) || !!(e.lookup && (e.lookup.alreadySubmitted || !e.lookup.canPay));

  const ready = entries.filter((e) => digitsOf(e.phone).length === 10 && e.name.trim() && e.lookup && !blocked(e));
  const allResolved = entries.every((e) => e.lookup && !e.busy);
  const canContinue = ready.length > 0 && ready.length === entries.length && allResolved && !!week?.isOpen;

  async function readCard() {
    setErr(null);
    setStage('checking');
    const r = await kiosk.leagueCheck(league.id);
    if (isErr(r)) {
      setStage('players');
      return setErr(r.error);
    }
    setCheck(r as LeagueCheckResult);
    setStage('confirm');
  }

  async function submit() {
    setErr(null);
    setStage('submitting');
    const r = await kiosk.leagueSubmit({ leagueId: league.id, weekId: week?.id ?? null, entries: ready.map((e) => ({ phone: digitsOf(e.phone), name: e.name.trim() })) });
    if (isErr(r)) {
      setStage('confirm');
      return setErr(r.error);
    }
    setResult(r as LeagueSubmitResult);
    setStage('result');
  }

  if (!week) {
    return (
      <div className="league-theme league-done">
        <h2>No league week is open right now</h2>
        <p className="muted">Check back when the next week opens.</p>
        <button className="btn btn-lg" style={{ marginTop: 20 }} onClick={onClose}>Close</button>
      </div>
    );
  }

  /* ── Results ── */
  if (stage === 'result' && result) {
    const accepted = result.results.filter((r) => r.status === 'ACCEPTED');
    const failed = result.results.filter((r) => r.status === 'FAILED');
    const allBad = result.rejected || accepted.length === 0;
    return (
      <div className="league-theme league-done">
        <div className={`league-done-icon ${allBad ? 'bad' : ''}`}>{allBad ? <CloseIcon size={40} /> : <CheckIcon size={40} />}</div>
        <h2>{result.rejected ? 'Scorecard rejected' : accepted.length ? `${accepted.length} score${accepted.length === 1 ? '' : 's'} submitted for Week ${result.weekNumber}` : 'Nothing was submitted'}</h2>
        {result.rejected && (
          <div className="error" style={{ marginTop: 10, textAlign: 'left' }}>
            {result.rejectReasons.map((r, i) => <div key={i}>{r}</div>)}
            <div className="muted" style={{ marginTop: 8, fontSize: 15 }}>No one was charged. Fix the settings in GSPro, replay if needed, and submit again before {week.deadlineLabel}.</div>
          </div>
        )}
        <div className="league-results">
          {result.results.map((r, i) => (
            <div key={i} className={`league-result ${r.status === 'ACCEPTED' ? 'ok' : 'bad'}`}>
              <div className="league-result-icon">{r.status === 'ACCEPTED' ? <CheckIcon size={20} /> : <CloseIcon size={20} />}</div>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontWeight: 700 }}>
                  {r.name}
                  {r.status === 'ACCEPTED' && r.gross != null && <span className="muted" style={{ fontWeight: 500 }}> · {r.front9} + {r.back9} = <b style={{ color: 'var(--text)' }}>{r.gross}</b></span>}
                </div>
                <div className="muted" style={{ fontSize: 15 }}>{r.message}{r.joined ? ' · joined the league' : ''}</div>
                {r.status === 'FAILED' && r.code === 'PAYMENT_REQUIRED' && (
                  <div className="league-fix">Add a card in the Tee24 app → Settings → Membership → Payment method, then submit again from this scorecard before {week.deadlineLabel}. Nothing was charged.</div>
                )}
                {r.status === 'FAILED' && r.code === 'NAME_NOT_ON_CARD' && result.cardNames.length > 0 && (
                  <div className="league-fix">Names on the card: {result.cardNames.join(', ')}</div>
                )}
              </div>
            </div>
          ))}
        </div>
        {result.warnings.length > 0 && (
          <div className="hint" style={{ marginTop: 12, textAlign: 'left' }}>
            {result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}
        {!result.rejected && accepted.length > 0 && (
          <p className="muted" style={{ marginTop: 14 }}>
            Scores show as “Submitted” until {week.deadlineLabel}, then the week is revealed, points are awarded and the pot is paid out. Next week&apos;s teams are drawn right after. Follow along in the Tee24 app.
          </p>
        )}
        {!result.rejected && failed.length > 0 && accepted.length > 0 && (
          <p className="muted" style={{ marginTop: 8, fontSize: 15 }}>Players marked ✕ weren&apos;t saved or charged — they can submit again from this scorecard once the issue is fixed.</p>
        )}
        <button className="btn btn-primary btn-lg" style={{ marginTop: 22 }} onClick={onClose}>Done</button>
      </div>
    );
  }

  /* ── Reading the screen ── */
  if (stage === 'checking' || stage === 'submitting') {
    return (
      <div className="league-theme league-done">
        <div className="league-done-icon"><span className="spinner spinner-lg" /></div>
        <h2>{stage === 'checking' ? 'Reading the scorecard…' : 'Submitting…'}</h2>
        <p className="muted">
          {stage === 'checking'
            ? 'This window hides for a moment while the kiosk takes a picture of GSPro.'
            : 'Charging entries and saving scores. This takes a few seconds.'}
        </p>
      </div>
    );
  }

  /* ── Confirm ── */
  if (stage === 'confirm' && check) {
    const paying = ready.filter((e) => !(e.lookup?.isMinor ?? false));
    const free = ready.length - paying.length;
    const missing = ready.filter((e) => check.isScorecard && !nameOnCard(e.name, check.cardNames));
    const hardBlock = !check.isScorecard || check.hard.length > 0;
    return (
      <div className="league-theme stack">
        <div className={`card league-check ${hardBlock ? 'bad' : 'ok'}`}>
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="eyebrow">{check.isScorecard ? 'Scorecard found' : 'No scorecard on screen'}</div>
              <div className="card-title" style={{ marginBottom: 4 }}>
                {check.isScorecard ? `${check.cardNames.length} player${check.cardNames.length === 1 ? '' : 's'} on the card` : 'Bring up the GSPro scorecard, then try again'}
              </div>
              {check.isScorecard && <div className="muted" style={{ fontSize: 15 }}>{check.cardNames.join(' · ')}</div>}
            </div>
            <div className="league-check-settings">
              <SettingPill label="Mulligans" value={check.settings.mulligans == null ? '?' : check.settings.mulligans ? 'ON' : 'OFF'} bad={check.settings.mulligans === true} unknown={check.settings.mulligans == null} />
              <SettingPill label="Gimmes" value={check.settings.gimmeFt == null ? '?' : `${check.settings.gimmeFt}'`} bad={check.settings.gimmeFt != null && check.settings.gimmeFt !== league.settings.gimmeDistanceFt} unknown={check.settings.gimmeFt == null} />
              {check.settings.greens && <SettingPill label="Greens" value={check.settings.greens} />}
            </div>
          </div>
          {check.hard.length > 0 && (
            <div className="error" style={{ marginTop: 12 }}>
              {check.hard.map((h, i) => <div key={i}>{h}</div>)}
              <div className="muted" style={{ marginTop: 6, fontSize: 15 }}>The card will be rejected and no one charged. Fix the setting in GSPro and read the card again.</div>
            </div>
          )}
          {check.soft.length > 0 && (
            <div className="hint" style={{ marginTop: 10 }}>
              {check.soft.map((h, i) => <div key={i}>⚠ {h}</div>)}
            </div>
          )}
          {missing.length > 0 && !hardBlock && (
            <div className="hint" style={{ marginTop: 10 }}>
              ⚠ {missing.map((e) => `“${e.name}”`).join(', ')} {missing.length === 1 ? "doesn't" : "don't"} match a name on the card. Go back and fix the name, or that player will be rejected.
            </div>
          )}
        </div>

        <div className="card league-confirm">
          <div className="card-title">Before you submit</div>
          <ul className="league-rules">
            <li>
              <b>{money(league.weeklyFeeCents)} per player, per week</b> — charged right now to each member&apos;s card on file
              {paying.length > 0 && <> ({paying.map((e) => `${e.lookup!.member.firstName} ····${e.lookup!.card?.last4 ?? ''}`).join(', ')})</>}
              {free > 0 && <>; {free} under {league.settings.minorAge} play free</>}.
            </li>
            <li><b>100% of entries are paid back out</b> — {league.settings.firstPlacePct}% to 1st (up to {money(league.settings.firstPlaceCapCents)}), {league.settings.secondPlacePct}% to 2nd (up to {money(league.settings.secondPlaceCapCents)}), the rest builds the League Championship pot.</li>
            <li><b>One score per player per week.</b> Scores stay hidden until {week.deadlineLabel}. No make-up rounds.</li>
            <li><b>Mulligans OFF, gimmes {league.settings.gimmeDistanceFt}&apos;.</b> If the card shows otherwise it is rejected and no one is charged.</li>
          </ul>
          <div className="row" style={{ marginTop: 12, gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            {onOpenRules && <button className="btn btn-ghost" style={{ fontSize: 15 }} onClick={onOpenRules}>Read the full rules</button>}
            <span className="muted league-url">{league.rulesUrl.replace(/^https?:\/\//, '')}</span>
          </div>
        </div>

        {err && <div className="error">{err}</div>}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-lg" onClick={() => setStage('players')}>Back</button>
          <div className="row">
            <button className="btn btn-lg" onClick={readCard}>Read the card again</button>
            <button className="btn btn-primary btn-lg" onClick={submit} disabled={hardBlock}>
              Confirm &amp; submit {ready.length} score{ready.length === 1 ? '' : 's'}{paying.length > 0 ? ` · ${money(league.weeklyFeeCents * paying.length)}` : ''}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Players ── */
  return (
    <div className="league-theme stack">
      <div className="league-week-banner">
        <div>
          <div className="eyebrow">Week {week.weekNumber}{week.courseName ? ` · ${week.courseName}` : ''}</div>
          <div className="muted" style={{ fontSize: 15 }}>Deadline {week.deadlineLabel} · this week&apos;s pot <b>{money(week.potCents)}</b> · {week.submittedCount} submitted</div>
        </div>
        <LeagueSettings league={league} compact />
      </div>
      {!week.isOpen && <div className="error">Week {week.weekNumber} isn&apos;t open for submissions right now.</div>}

      <div className="hint league-warning">Finish all 18 holes and leave the GSPro scorecard on screen. <b>Mulligans must be OFF</b> — a card showing mulligans on is rejected and nobody is charged.</div>

      <div className="card-title" style={{ marginBottom: 0 }}>Who&apos;s on this scorecard?</div>
      <div className="muted" style={{ fontSize: 15, marginTop: -6 }}>Phone number + name exactly as GSPro shows it. Up to 5 players. Each player is charged {money(league.weeklyFeeCents)} to their card on file.</div>

      {entries.map((e, i) => {
        const digits = digitsOf(e.phone);
        const dup = isDuplicate(e);
        return (
          <div key={i} className={`card league-entry ${blocked(e) ? 'blocked' : ''}`}>
            <div className="league-entry-num">{i + 1}</div>
            <div className="league-entry-fields">
              <div className="field">
                <label><PhoneIcon size={14} /> Phone</label>
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder="(555) 555-5555"
                  value={e.phone}
                  autoFocus={i === 0}
                  onChange={(ev) => update(i, { phone: formatPhoneInput(ev.target.value), lookup: null, error: null })}
                  onBlur={() => digits.length === 10 && !e.lookup && void lookup(i)}
                  onKeyDown={(ev) => ev.key === 'Enter' && void lookup(i)}
                />
              </div>
              <div className="field">
                <label>Name on scorecard</label>
                <input className="input" placeholder="e.g. Rob G" value={e.name} onChange={(ev) => update(i, { name: ev.target.value })} />
              </div>
            </div>
            <div className="league-entry-status">
              {e.busy && <span className="spinner" />}
              {!e.busy && dup && <span className="badge badge-bad">Same phone twice</span>}
              {!e.busy && !dup && e.lookup && <LookupBadges lk={e.lookup} league={league} />}
              {!e.busy && !dup && !e.lookup && !e.error && digits.length === 10 && (
                <button className="btn" onClick={() => void lookup(i)}>Find</button>
              )}
              {!e.busy && e.error && <span className="badge badge-bad">{e.error}</span>}
              {entries.length > 1 && (
                <button className="btn btn-ghost" aria-label="Remove" onClick={() => setEntries((es) => es.filter((_, j) => j !== i))}><DeleteIcon size={20} /></button>
              )}
            </div>
            {!e.busy && e.lookup && !e.lookup.canPay && (
              <div className="league-entry-note">
                No card on file — {e.lookup.member.firstName} must add a card in the Tee24 app (Settings → Membership → Payment method) before this score can be accepted. Remove them for now, or add the card and tap Find again.
              </div>
            )}
            {!e.busy && e.lookup && e.lookup.alreadySubmitted && (
              <div className="league-entry-note">
                {e.lookup.member.firstName} already has a score in for Week {e.lookup.weekNumber ?? week.weekNumber}. One score per player per week — remove them to continue.
              </div>
            )}
          </div>
        );
      })}
      {entries.length < 5 && (
        <button className="btn" onClick={() => setEntries((es) => [...es, blank()])}>+ Add another player</button>
      )}
      {err && <div className="error">{err}</div>}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <button className="btn btn-lg" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary btn-lg" disabled={!canContinue} onClick={readCard}>
          Continue {ready.length > 0 ? `· ${ready.length} player${ready.length === 1 ? '' : 's'}` : ''}
        </button>
      </div>
    </div>
  );
}

function LookupBadges({ lk, league }: { lk: LeagueLookup; league: LeagueInfo }) {
  const name = `${lk.member.firstName} ${lk.member.lastInitial}.`;
  if (lk.alreadySubmitted) return <span className="badge badge-bad">{name} · already submitted</span>;
  if (lk.isMinor) return <span className="badge badge-warn">{name} · under {league.settings.minorAge} · free{!lk.inLeague ? ' · new' : ''}</span>;
  if (!lk.hasCard) return <span className="badge badge-bad">{name} · no card</span>;
  return <span className="badge badge-ok">{name} · ····{lk.card?.last4 ?? ''}{!lk.inLeague ? ' · new' : ''}</span>;
}

function SettingPill({ label, value, bad, unknown }: { label: string; value: string; bad?: boolean; unknown?: boolean }) {
  return (
    <div className={`league-pill ${bad ? 'bad' : unknown ? 'unknown' : 'ok'}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
