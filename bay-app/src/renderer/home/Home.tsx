import { useEffect, useState } from 'react';
import { kiosk, isErr, useServerNow, formatCountdown } from '../shared/bridge';
import type { KioskState, WalkInPlan } from '../shared/types';
import { PlayIcon, WrenchIcon, GearIcon, HelpIcon, CalendarIcon } from '../shared/Icons';
import { Logo } from '../shared/Logo';
import { PlayFlow } from './PlayFlow';
import { TodaySchedule } from './TodaySchedule';

type AskPlan = Exclude<WalkInPlan, { mode: 'launch' }>;

export function Home({ state, onSetupHelp, onSettings }: { state: KioskState; onSetupHelp: () => void; onSettings: () => void }) {
  const [launching, setLaunching] = useState(false);
  const [checking, setChecking] = useState(false);
  const [plan, setPlan] = useState<AskPlan | null>(null);
  // Bumped every time the player is asked, so a re-check starts the flow again from its first step.
  const [asked, setAsked] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [booked, setBooked] = useState(0);
  const now = useServerNow(state.serverOffsetMs);
  const s = state.settings;
  const bayLabel = s.bayName ? `Bay ${s.bayNumber} · ${s.bayName}` : `Bay ${s.bayNumber}`;
  const running = state.launcher.running;

  // The "reserved until" note belongs to one session; drop it when that session is over.
  useEffect(() => {
    if (!running) setNote(null);
  }, [running]);

  /** Ask the server what Play should do. Anything but "ask the player" means launch. */
  async function check(): Promise<AskPlan | null> {
    const r: unknown = await kiosk.playCheck();
    if (isErr(r)) return null;
    const p = r as WalkInPlan;
    return p.mode === 'confirm' || p.mode === 'walkin' ? p : null;
  }

  async function play() {
    if (checking || launching) return;
    setErr(null);
    setNote(null);
    setChecking(true);
    const p = await check();
    setChecking(false);
    if (p) return ask(p);
    await launch();
  }

  function ask(p: AskPlan) {
    setAsked((n) => n + 1);
    setPlan(p);
  }

  async function launch(reservedNote?: string) {
    setPlan(null);
    if (reservedNote) {
      setNote(reservedNote);
      setBooked((n) => n + 1);
    }
    setLaunching(true);
    setErr(null);
    const r = await kiosk.play();
    setLaunching(false);
    if (isErr(r)) return setErr(r.error);
    const st = r as KioskState['launcher'];
    if (st.lastError && !st.running) setErr(st.lastError);
    else if (st.lastError) setErr(`GSPro started. Launch monitor: ${st.lastError}`);
  }

  /** The bay was booked by someone else while this player was choosing. */
  async function replan(message: string) {
    setPlan(null);
    setChecking(true);
    const p = await check();
    setChecking(false);
    if (!p) return launch();
    // The "booked at…" modal explains itself; a fresh set of durations needs the reason.
    if (p.mode === 'walkin') setErr(message);
    ask(p);
  }

  const cd = state.countdown;
  const cdLeft = cd ? new Date(cd.until).getTime() - now : null;
  // Play pressed, GSPro process not seen yet: keep the home screen up with a status.
  const starting = running && !state.launcher.gsproPid;
  const signingOut = state.signingOut;
  const busy = launching || checking || starting || signingOut;

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
              <h2>{signingOut ? 'Signing out…' : starting ? 'Starting GSPro…' : 'Play'}</h2>
              <p>
                {signingOut
                  ? 'Closing GSPro and the launch monitor. Play is ready again in a few seconds.'
                  : starting
                    ? 'This can take up to a minute. The screen switches to GSPro as soon as it opens.'
                    : /IDRAMonitor\.exe$/i.test(s.launchMonitorPath) ? 'Starts GSPro with the IDRA launch monitor.' : 'Starts the launch monitor and GSPro.'}
              </p>
            </button>
            <button className="tile" onClick={onSetupHelp}>
              <span className="tile-icon"><WrenchIcon size={30} /></span>
              <h2>Setup Help</h2>
              <p>Bay setup walkthrough and the troubleshooting guide.</p>
            </button>
          </div>
          {note && !err && <div className="success" style={{ marginTop: 20 }}>{note}</div>}
          {err && !plan && <div className="error" style={{ marginTop: 20 }}>{err}</div>}
          {state.lastError && !state.online && (
            <div className="hint" style={{ marginTop: 14, textAlign: 'center' }}>Offline — reservations will sync when the connection returns.</div>
          )}
          <TodaySchedule now={now} bayNumber={s.bayNumber} refreshKey={`${running}|${state.status?.currentBooking?.id ?? ''}|${booked}`} />
        </div>
      </div>

      <div className="home-bottom">
        <span>{state.online ? <span className="badge badge-ok"><span className="dot" /> Connected</span> : <span className="badge badge-bad"><span className="dot" /> Offline</span>}</span>
        <span>Tee24 Bay Kiosk v{state.version}</span>
      </div>

      {plan && <PlayFlow key={asked} plan={plan} bayLabel={`Bay ${s.bayNumber}`} notice={err} onLaunch={launch} onCancel={() => { setPlan(null); setErr(null); }} onReplan={replan} />}
    </div>
  );
}
