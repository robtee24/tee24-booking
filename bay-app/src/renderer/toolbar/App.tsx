import { kiosk, useKioskState, useServerNow, formatCountdown } from '../shared/bridge';
import { HelpIcon, CalendarIcon, UploadIcon } from '../shared/Icons';

/** Floating Help / Schedule / Export strip shown on the right edge while GSPro runs. */
export function App() {
  const state = useKioskState();
  const now = useServerNow(state?.serverOffsetMs ?? 0);
  const cd = state?.countdown ?? null;
  const left = cd ? new Date(cd.until).getTime() - now : null;

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
      <button className="fab fab-export" onClick={() => kiosk.openOverlay('export')} title="Send your GSPro shot data to the Tee24 app or your email">
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
