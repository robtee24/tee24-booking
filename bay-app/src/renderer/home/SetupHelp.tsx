import { useState } from 'react';
import type { KioskState } from '../shared/types';
import { TroubleshootFlow, labelLM } from '../shared/TroubleshootFlow';
import { BackIcon } from '../shared/Icons';
import { TimerArt, ProjectorArt, PlayArt, ModesArt, MatArt } from './GuideArt';

/** "6155551234" / "+16155551234" → "(615) 555-1234"; anything else is shown as-is. */
function formatPhoneDisplay(raw: string): string {
  const d = raw.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
}

type Tab = 'walkthrough' | 'troubleshoot';

/** "Setup Help" tile: a setup walkthrough for this bay plus the troubleshooting guide. */
export function SetupHelp({ state, onClose }: { state: KioskState; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('walkthrough');
  const lm = state.status?.bay.launchMonitor ?? state.settings.launchMonitor ?? 'OTHER';
  const notes = state.status?.bay.setupNotes;
  const phone = state.status?.location.phone ?? null;

  return (
    <div className="page">
      <div className="page-header">
        <button className="btn btn-ghost" onClick={onClose}><BackIcon size={20} /> Back</button>
        <h1>Setup Help</h1>
        <div className="row" style={{ marginLeft: 'auto' }}>
          <button className={`btn ${tab === 'walkthrough' ? 'btn-primary' : ''}`} onClick={() => setTab('walkthrough')}>Setup walkthrough</button>
          <button className={`btn ${tab === 'troubleshoot' ? 'btn-primary' : ''}`} onClick={() => setTab('troubleshoot')}>Troubleshooting guide</button>
        </div>
      </div>
      <div className="page-body">
        {tab === 'walkthrough' ? (
          <div className="guide">
            <div className="guide-grid">
              {GUIDE_STEPS.map((s, i) => (
                <div key={i} className="card guide-step">
                  {s.art}
                  <div className="guide-step-body">
                    <div className="guide-step-num">{i + 1}</div>
                    <div>
                      <div className="card-title">{s.title}</div>
                      <div className="card-sub">{s.body}</div>
                      {s.note && <div className="guide-note">{s.note}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="card guide-callout">
              <div className="guide-callout-icon"><MatArt /></div>
              <div>
                <div className="card-title">Hit from the back 2/3 of the mat</div>
                <div className="card-sub">
                  Keep the mat and the area right around it clear of golf balls and anything else white — stray white objects confuse the cameras.
                </div>
              </div>
            </div>
            <div className="guide-bottom">
              <div className="card">
                <div className="card-title">Notes for this bay · {labelLM(lm)}</div>
                {notes ? <div className="notes" style={{ marginTop: 10 }}>{notes}</div> : <div className="card-sub">No bay-specific notes yet. Admins can add them under Settings → Bay details.</div>}
              </div>
              <div className="card">
                <div className="card-title">Need a hand?</div>
                <div className="card-sub">
                  If you haven’t been able to fix the issue, or need help getting started, call{' '}
                  {phone ? <b className="guide-phone">{formatPhoneDisplay(phone)}</b> : <b>the Tee24 number on your confirmation message</b>}
                  {' '}and press <b>extension 1</b> for immediate help.
                </div>
                <div className="card-sub" style={{ marginTop: 6 }}>The Help button (also floating on the right while GSPro is open) has step-by-step fixes for common problems.</div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 900 }}>
            <TroubleshootFlow startAt="entry" />
          </div>
        )}
      </div>
    </div>
  );
}

const GUIDE_STEPS: { title: string; body: string; note?: string; art: React.ReactNode }[] = [
  {
    title: 'Start the simulator timer',
    body: 'The timer switch is mounted upright on the wall near the monitor in every bay. Select the amount of time you want (5 minutes up to 4 hours) and the simulator powers on.',
    art: <TimerArt />,
  },
  {
    title: 'Turn on the projector',
    body: 'Point the remote at the projector and press the green ON button. The projector is at the front of the bay, right where you first walk in. Give it a few seconds to warm up.',
    art: <ProjectorArt />,
  },
  {
    title: 'Click Play on this screen',
    body: 'Clicking Play starts the launch monitor software and GSPro together. Wait for the GSPro welcome screen; this screen will switch over on its own.',
    art: <PlayArt />,
  },
  {
    title: 'Pick what to play in GSPro',
    body: 'Practice for the driving range · Local Match for a round of golf · Challenges for game-improvement contests.',
    note: 'Sim Golf Tournaments need your own GSPro account. Online Match is for linking multiple bays together.',
    art: <ModesArt />,
  },
];
