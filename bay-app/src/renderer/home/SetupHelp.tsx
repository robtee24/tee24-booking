import { useState } from 'react';
import type { KioskState } from '../shared/types';
import { TroubleshootFlow, labelLM } from '../shared/TroubleshootFlow';
import { BackIcon } from '../shared/Icons';

type Tab = 'walkthrough' | 'troubleshoot';

/** "Setup Help" tile: a setup walkthrough for this bay plus the troubleshooting guide. */
export function SetupHelp({ state, onClose }: { state: KioskState; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('walkthrough');
  const lm = state.status?.bay.launchMonitor ?? state.settings.launchMonitor ?? 'OTHER';
  const notes = state.status?.bay.setupNotes;

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
          <div className="grid-2">
            <div className="card">
              <div className="card-title">Getting the bay ready · {labelLM(lm)}</div>
              <div className="card-sub" style={{ marginBottom: 18 }}>Follow these in order. If anything doesn’t look right, open the troubleshooting guide.</div>
              <ol className="steps">
                {walkthroughFor(lm).map((s, i) => (
                  <li key={i}>
                    <strong>{s.title}</strong>
                    <p>{s.body}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="stack">
              <div className="card">
                <div className="card-title">Notes for this bay</div>
                {notes ? <div className="notes" style={{ marginTop: 10 }}>{notes}</div> : <div className="card-sub">No bay-specific notes yet. Admins can add them under Settings → Bay details.</div>}
              </div>
              <div className="card">
                <div className="card-title">Still stuck?</div>
                <div className="card-sub">Use the Help button (also floating on the right while GSPro is open) for step-by-step fixes, or text the Tee24 number on your confirmation message.</div>
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

function walkthroughFor(lm: string): { title: string; body: string }[] {
  const common = [
    { title: 'Power', body: 'Projector, PC, and launch monitor all on. The projector input should show the Windows desktop (this screen).' },
    { title: 'Tee up in the hitting zone', body: 'Place the ball on the marked spot. Most “no shot read” problems are a ball outside the sensor zone.' },
  ];
  const byLm: Record<string, { title: string; body: string }[]> = {
    IDRA: [
      { title: 'Launch monitor connected', body: 'The IDRA II should be powered and plugged into the PC. If its light is blinking, wait 30 seconds for it to finish booting.' },
      { title: 'Press Play', body: 'Play starts the IDRA software, which opens GSPro itself. Wait for the orange IDRA badge at the top of the GSPro screen — that means the launch monitor is connected.' },
      { title: 'Calibration', body: 'If shots fly oddly, run IDRA Auto-Calibration from the Windows Start menu. Keep your hands clear of the sensor during it.' },
    ],
    SKYTRAK: [
      { title: 'SkyTrak awake', body: 'Tap the power button once; the light turns green when it’s ready. Red means it’s charging/asleep.' },
      { title: 'Press Play', body: 'Play opens the SkyTrak app and GSPro. Wait for GSPro to say “Connected”.' },
      { title: 'Alignment', body: 'The red laser dot should sit right beside the ball. Move the ball, not the unit.' },
    ],
    PROTEE_VX: [
      { title: 'ProTee VX ready', body: 'Camera status lights on the VX should be solid green.' },
      { title: 'Press Play', body: 'Play opens the ProTee interface and GSPro. Wait for GSPro to say “Connected”.' },
      { title: 'Lighting', body: 'Avoid pointing bright lights at the cameras; dim overheads if the VX stops tracking.' },
    ],
    OTHER: [
      { title: 'Launch monitor ready', body: 'Make sure the launch monitor shows as ready and is pointed at the hitting zone.' },
      { title: 'Press Play', body: 'Play opens the launch monitor software and GSPro. Wait for GSPro to say “Connected”.' },
    ],
  };
  return [...common, ...(byLm[lm] ?? byLm.OTHER), { title: 'Choose a course and play', body: 'In GSPro pick Local Play (or your event), set tees, and hit away. When your time is almost up the kiosk will let you know.' }];
}
