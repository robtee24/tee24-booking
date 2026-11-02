import { useState } from 'react';
import { Modal } from './App';
import { LeagueRulesSummary, LeagueSettings, LeagueSubmitFlow, LeagueTutorial, useLeagues, weekTitle } from '../shared/LeagueFlow';

type Panel = 'submit' | 'tutorial' | 'rules';

/**
 * Toolbar → League. Submit the scorecard that is on screen; the tutorial and
 * the rules/settings are one tap away without leaving the modal.
 */
export function LeagueOverlay({ onClose }: { onClose: () => void }) {
  const { leagues, err } = useLeagues();
  const [pick, setPick] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('submit');
  const league = leagues ? leagues.find((l) => l.id === pick) ?? leagues[0] ?? null : null;

  if (panel === 'tutorial' && league) {
    return (
      <Modal title="How to submit a league round" eyebrow={league.name} wide onClose={() => setPanel('submit')}>
        <div className="league-theme league-two-col">
          <LeagueTutorial league={league} />
          <div className="stack">
            <div>
              <div className="card-title">Settings to play by</div>
              <LeagueSettings league={league} />
            </div>
            <div className="muted league-note">Full rules: <span className="league-url">{league.rulesUrl.replace(/^https?:\/\//, '')}</span></div>
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-primary btn-lg" onClick={() => setPanel('submit')}>Back to submit</button>
        </div>
      </Modal>
    );
  }

  if (panel === 'rules' && league) {
    return (
      <Modal title="League rules" eyebrow={league.name} wide onClose={() => setPanel('submit')}>
        <div className="league-theme stack">
          <LeagueRulesSummary league={league} />
          <div className="muted league-note">Full rules: <span className="league-url">{league.rulesUrl.replace(/^https?:\/\//, '')}</span> · also under League → Rules in the Tee24 app.</div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-primary btn-lg" onClick={() => setPanel('submit')}>Back to submit</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={league ? weekTitle(league) : 'League'} eyebrow={league?.name ?? 'Tee24 League'} wide onClose={onClose}>
      <div className="league-theme">
        {!leagues && !err && <div className="muted">Loading…</div>}
        {err && <div className="error">{err}</div>}
        {leagues && leagues.length === 0 && (
          <div className="league-done">
            <h2>No league is running right now</h2>
            <p className="muted">Ask the front desk when the next season starts.</p>
            <button className="btn btn-lg" style={{ marginTop: 20 }} onClick={onClose}>Close</button>
          </div>
        )}
        {league && (
          <div className="row between" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="row">
              {leagues && leagues.length > 1 && leagues.map((l) => (
                <button key={l.id} className={`btn ${l.id === league.id ? 'btn-primary' : ''}`} onClick={() => setPick(l.id)}>{l.name}</button>
              ))}
            </div>
            <div className="row">
              <button className="btn" onClick={() => setPanel('tutorial')}>How to submit</button>
              <button className="btn" onClick={() => setPanel('rules')}>Rules</button>
            </div>
          </div>
        )}
        {league && <LeagueSubmitFlow league={league} onClose={onClose} onOpenRules={() => setPanel('rules')} />}
      </div>
    </Modal>
  );
}
