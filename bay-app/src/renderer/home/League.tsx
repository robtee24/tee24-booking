import { useState } from 'react';
import type { KioskState, LeagueInfo } from '../shared/types';
import { BackIcon } from '../shared/Icons';
import { LeagueJoin, LeagueRulesSummary, LeagueSettings, LeagueTutorial, championshipLabel, money, useLeagues, weekTitle } from '../shared/LeagueFlow';

type Tab = 'how' | 'rules' | 'settings' | 'join';

/**
 * Home → "League": this week's challenge, the step-by-step tutorial, the
 * rules, the GSPro settings to play by, and join. Scores are submitted from
 * the toolbar League button while the scorecard is on screen.
 */
export function League({ state, onClose }: { state: KioskState; onClose: () => void }) {
  const { leagues, err } = useLeagues();
  const [tab, setTab] = useState<Tab>('how');
  const [pick, setPick] = useState<string | null>(null);
  const league: LeagueInfo | null = leagues ? leagues.find((l) => l.id === pick) ?? leagues[0] ?? null : null;
  const champ = league ? championshipLabel(league) : null;

  return (
    <div className="page league-theme">
      <div className="page-header">
        <button className="btn btn-ghost" onClick={onClose}><BackIcon size={20} /> Back</button>
        <h1 className="league-serif">{state.settings.locationName ?? 'Tee24'} League</h1>
        {league && (
          <div className="row league-tabs" style={{ marginLeft: 'auto' }}>
            <button className={`btn ${tab === 'how' ? 'btn-primary' : ''}`} onClick={() => setTab('how')}>How to submit</button>
            <button className={`btn ${tab === 'rules' ? 'btn-primary' : ''}`} onClick={() => setTab('rules')}>Rules</button>
            <button className={`btn ${tab === 'settings' ? 'btn-primary' : ''}`} onClick={() => setTab('settings')}>League Settings</button>
            <button className={`btn ${tab === 'join' ? 'btn-primary' : ''}`} onClick={() => setTab('join')}>Join</button>
          </div>
        )}
      </div>
      <div className="page-body">
        {!leagues && !err && <div className="muted">Loading league…</div>}
        {err && <div className="error">{err}</div>}
        {leagues && leagues.length === 0 && (
          <div className="card" style={{ padding: 28 }}>
            <div className="card-title">No league is running right now</div>
            <div className="muted">Ask the front desk when the next season starts.</div>
          </div>
        )}
        {league && (
          <div className="league-page">
            {leagues && leagues.length > 1 && (
              <div className="row" style={{ marginBottom: 14 }}>
                {leagues.map((l) => (
                  <button key={l.id} className={`btn ${l.id === league.id ? 'btn-primary' : ''}`} onClick={() => setPick(l.id)}>{l.name}</button>
                ))}
              </div>
            )}
            <div className="card league-hero">
              <div>
                <div className="eyebrow">{league.name}</div>
                <h2 className="league-serif">{weekTitle(league)}</h2>
                {league.week ? (
                  <div className="muted">
                    {league.week.isOpen ? 'Open now' : 'Opens soon'} · deadline <b>{league.week.deadlineLabel}</b> · this week&apos;s pot <b>{money(league.week.potCents)}</b> · {league.week.submittedCount} submitted
                  </div>
                ) : (
                  <div className="muted">The season schedule hasn&apos;t started yet.</div>
                )}
              </div>
              <div className="league-hero-stats">
                <div><span>{league.playerCount}</span>players</div>
                <div><span>{money(league.weeklyFeeCents)}</span>per week</div>
                <div><span>{money(league.championshipPotCents)}</span>championship pot</div>
                {league.championshipAt && <div><span>{new Date(league.championshipAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>championship</div>}
              </div>
            </div>

            {tab === 'how' && (
              <div className="league-two-col">
                <div className="card" style={{ padding: 24 }}>
                  <div className="card-title">How to submit a league round</div>
                  <div className="muted league-note" style={{ marginTop: -4, marginBottom: 14 }}>Scores are submitted here at the bay only — tap <b>League</b> on the side toolbar when your GSPro scorecard is on screen.</div>
                  <LeagueTutorial league={league} />
                </div>
                <div className="stack">
                  <div className="card" style={{ padding: 24 }}>
                    <div className="card-title">Settings to play by</div>
                    <LeagueSettings league={league} />
                  </div>
                  <div className="card" style={{ padding: 24 }}>
                    <div className="card-title">Full rules</div>
                    <div className="muted league-note">Everything in one place — handicaps, teams, points and money:</div>
                    <div className="league-url" style={{ marginTop: 8 }}>{league.rulesUrl.replace(/^https?:\/\//, '')}</div>
                    <div className="muted league-note" style={{ marginTop: 6 }}>Also under League → Rules in the Tee24 app.</div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'rules' && (
              <div className="stack">
                <LeagueRulesSummary league={league} />
                <div className="card" style={{ padding: 24 }}>
                  <div className="card-title">Deadline &amp; reveal</div>
                  <ul className="league-rules">
                    <li>Weeks run Monday 12:00 AM → <b>Sunday 11:59 PM</b>. One score per player per week, no make-ups.</li>
                    <li>Scores show as “Submitted” until the deadline, then the whole week is revealed at once and the pot is paid out.</li>
                    <li>Next week&apos;s 2-player teams are drawn right after the reveal — see them under Teams in the app.</li>
                    {champ && <li>League Championship: <b>{champ}</b>. Top {league.settings.championshipTopPct}% by points qualify; 100% of the championship pot is paid out.</li>}
                  </ul>
                  <div className="muted league-note" style={{ marginTop: 10 }}>Full rules: <span className="league-url">{league.rulesUrl.replace(/^https?:\/\//, '')}</span></div>
                </div>
              </div>
            )}

            {tab === 'settings' && (
              <div className="card" style={{ padding: 24 }}>
                <div className="card-title">Set these in GSPro before you start</div>
                <div className="muted" style={{ marginBottom: 16, fontSize: 15 }}>
                  The kiosk reads the scorecard when you submit: mulligans must show <b>OFF</b> and gimmes <b>{league.settings.gimmeDistanceFt}&apos;</b>, or the card is rejected and no one is charged. Greens and tees are on the honor system.
                </div>
                <LeagueSettings league={league} />
              </div>
            )}

            {tab === 'join' && (
              <div className="league-two-col">
                <div className="card" style={{ padding: 24 }}>
                  <div className="card-title">Join the league</div>
                  <div className="muted" style={{ marginBottom: 16, fontSize: 15 }}>Any Tee24 member can join any time — enter your phone number. You can also join from the Tee24 app, or simply submit a scorecard and you&apos;re in.</div>
                  <LeagueJoin league={league} onDone={() => setTab('how')} />
                </div>
                <div className="card" style={{ padding: 24 }}>
                  <div className="card-title">What it costs</div>
                  <ul className="league-rules">
                    <li>Nothing to join.</li>
                    <li>{money(league.weeklyFeeCents)} each week you submit a score, charged to your card on file at submission. No card on file means the score can&apos;t be accepted — add one in the Tee24 app first.</li>
                    <li>Under {league.settings.minorAge}: free. You&apos;re flagged on the leaderboard and not eligible for money.</li>
                    <li>Every dollar collected is paid back out to players.</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
