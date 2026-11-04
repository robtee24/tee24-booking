import { useState } from 'react';
import { kiosk, isErr, useServerNow, formatCountdown } from '../shared/bridge';
import type { KioskState } from '../shared/types';
import { PlayIcon, WrenchIcon, GearIcon, HelpIcon, CalendarIcon } from '../shared/Icons';
import { Logo } from '../shared/Logo';

export function Home({ state, onSetupHelp, onSettings }: { state: KioskState; onSetupHelp: () => void; onSettings: () => void }) {
  const [launching, setLaunching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const now = useServerNow(state.serverOffsetMs);
  const s = state.settings;
  const bayLabel = s.bayName ? `Bay ${s.bayNumber} · ${s.bayName}` : `Bay ${s.bayNumber}`;

  async function play() {
    setLaunching(true);
    setErr(null);
    const r = await kiosk.play();
    setLaunching(false);
    if (isErr(r)) return setErr(r.error);
    const st = r as KioskState['launcher'];
    if (st.lastError && !st.running) setErr(st.lastError);
    else if (st.lastError) setErr(`GSPro started. Launch monitor: ${st.lastError}`);
  }

  const cd = state.countdown;
  const cdLeft = cd ? new Date(cd.until).getTime() - now : null;
  // Play pressed, GSPro process not seen yet: keep the home screen up with a status.
  const starting = state.launcher.running && !state.launcher.gsproPid;
  const busy = launching || starting;

  return (
    <div className="home">
      <div className="home-top">
        <div className="brand">
          <Logo height={64} />
          <div>
            <div>{s.locationName ?? 'Tee24'}</div>
            <div className="tiny" style={{ fontWeight: 500 }}>{bayLabel}</div>
          </div>
        </div>
        <div className="row">
          {cd && cdLeft !== null && cdLeft > 0 && (
            <div className="badge badge-warn mono" style={{ fontSize: 15, padding: '8px 14px' }}>
              {cd.label} {formatCountdown(cdLeft)}
            </div>
          )}
          <button className="btn btn-ghost" onClick={() => kiosk.openOverlay('schedule')}>
            <CalendarIcon size={20} /> Schedule
          </button>
          <button className="btn btn-ghost" onClick={() => kiosk.openOverlay('help')}>
            <HelpIcon size={20} /> Help
          </button>
          <button className="gear" onClick={onSettings} title="Settings (admins)" aria-label="Settings">
            <GearIcon size={24} />
          </button>
        </div>
      </div>

      <div className="home-center">
        <div style={{ width: 'min(980px, 100%)' }}>
          <div className="home-actions">
            <button className="tile tile-play" onClick={play} disabled={busy}>
              <span className="tile-icon">{busy ? <span className="spinner" /> : <PlayIcon size={34} />}</span>
              <h2>{starting ? 'Starting GSPro…' : 'Play'}</h2>
              <p>
                {starting
                  ? 'Give it a few seconds. The screen switches to GSPro as soon as it opens.'
                  : /IDRAMonitor\.exe$/i.test(s.launchMonitorPath) ? 'Starts GSPro with the IDRA launch monitor.' : 'Starts the launch monitor and GSPro.'}
              </p>
            </button>
            <button className="tile" onClick={onSetupHelp}>
              <span className="tile-icon"><WrenchIcon size={30} /></span>
              <h2>Setup Help</h2>
              <p>Bay setup walkthrough and the troubleshooting guide.</p>
            </button>
          </div>
          {err && <div className="error" style={{ marginTop: 20 }}>{err}</div>}
          {state.lastError && !state.online && (
            <div className="hint" style={{ marginTop: 14, textAlign: 'center' }}>Offline — reservations will sync when the connection returns.</div>
          )}
        </div>
      </div>

      <div className="home-bottom">
        <span>{state.online ? <span className="badge badge-ok"><span className="dot" /> Connected</span> : <span className="badge badge-bad"><span className="dot" /> Offline</span>}</span>
        <span>Tee24 Bay Kiosk v{state.version}</span>
      </div>
    </div>
  );
}
