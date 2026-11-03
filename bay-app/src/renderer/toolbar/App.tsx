import { kiosk, useKioskState, useServerNow, formatCountdown } from '../shared/bridge';
import { HelpIcon, CalendarIcon, UploadIcon, TrophyIcon } from '../shared/Icons';

/** Floating Help / Schedule / Export strip shown on the right edge while GSPro runs. */
export function App() {
  const state = useKioskState();
  const now = useServerNow(state?.serverOffsetMs ?? 0);
  const cd = state?.countdown ?? null;
  // Export only makes sense on the practice range (that's where GSPro writes shot CSVs).
  const onRange = state?.screen.kind === 'range';
  const left = cd ? new Date(cd.until).getTime() - now : null;

  // Admin is in an IDRA tool: home is hidden, so this strip is the only way back.
  const m = state?.maintenance;
  if (m) {
    const label = m.tool === 'calibration' ? 'IDRA calibration' : 'IDRA updates';
    const where = m.tool === 'calibration' ? 'Calibration' : 'Updates';
    return (
      <div className="toolbar">
        <div className="maint">
          <div className="maint-eyebrow">Admin · Tee24 kiosk hidden</div>
          <div className="maint-title">{label}</div>
          <div className="maint-body">
            {m.viaLauncher
              ? <>In the GolfIn Launcher open <b>Settings</b>, then <b>{where}</b>. If the launcher is not showing, give it a few seconds or check the taskbar.</>
              : <>The {label.toLowerCase()} program is open. Finish there, then come back.</>}
          </div>
          <button className="btn btn-primary btn-block" onClick={() => kiosk.idraToolDone()}>Back to kiosk</button>
          <div className="maint-foot">Closes the GolfIn Launcher unless GSPro is running. Ctrl+Shift+T also returns.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="toolbar">
      <button className="fab fab-help" onClick={() => kiosk.openOverlay('help')} title="Help">
        <HelpIcon size={28} />
        Help
      </button>
      <button className="fab" onClick={() => kiosk.openOverlay('schedule')} title="Schedule">
        <CalendarIcon size={26} />
        Schedule
      </button>
      <button className="fab fab-league" onClick={() => kiosk.openOverlay('league')} title="Submit your league scorecard">
        <TrophyIcon size={26} />
        League
      </button>
      <button
        className="fab fab-export"
        disabled={!onRange}
        onClick={() => onRange && kiosk.openOverlay('export')}
        title={onRange ? 'Send your GSPro shot data to the Tee24 app or your email' : 'Export is available on the practice range'}
      >
        <UploadIcon size={26} />
        Export
      </button>
      {cd && left !== null && left > 0 && (
        <div className="fab fab-countdown" title={cd.label}>
          {cd.label}
          <b>{formatCountdown(left)}</b>
        </div>
      )}
    </div>
  );
}
