import { kiosk, useKioskState, useServerNow, formatCountdown } from '../shared/bridge';
import { HelpIcon, CalendarIcon } from '../shared/Icons';

/** Floating Help / Schedule strip shown on the right edge while GSPro runs. */
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
      {cd && left !== null && left > 0 && (
        <div className="fab fab-countdown" title={cd.label}>
          {cd.label}
          <b>{formatCountdown(left)}</b>
        </div>
      )}
    </div>
  );
}
