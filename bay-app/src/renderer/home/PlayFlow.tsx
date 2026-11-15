import { useState } from 'react';
import { kiosk, isErr, formatTime, formatPhoneInput, bookingName } from '../shared/bridge';
import type { WalkInPlan } from '../shared/types';
import { BackIcon, CloseIcon, DeleteIcon, PlayIcon } from '../shared/Icons';

type AskPlan = Exclude<WalkInPlan, { mode: 'launch' }>;

/** "30 minutes", "1 hour", "1 hr 30 min", "47 minutes". Mixed ones are abbreviated to stay on one line. */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} minutes`;
  if (!m) return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  return `${h} hr ${m} min`;
}

/**
 * What Play asks before GSPro starts (only at locations with walk-in
 * reservations turned on; everywhere else Play launches straight away).
 *
 *  - confirm: someone has the bay booked within 30 minutes. Say who and when
 *    and ask whether to continue.
 *  - walkin: the bay is free. Ask how long, then a phone number, and reserve
 *    the bay from now under that number.
 *
 * `onLaunch` starts GSPro. It is also the way out whenever the reservation
 * cannot be made for a reason that is not the player's (server unreachable):
 * the bay must stay playable.
 */
export function PlayFlow({
  plan,
  bayLabel,
  notice,
  onLaunch,
  onCancel,
  onReplan,
}: {
  plan: AskPlan;
  bayLabel: string;
  /** Why the player is being asked again (the bay was booked while they were choosing). */
  notice?: string | null;
  onLaunch: (note?: string) => void;
  onCancel: () => void;
  /** The bay's situation changed while the player was choosing (someone just booked it). */
  onReplan: (message: string) => void;
}) {
  return (
    <div className="home-modal">
      {plan.mode === 'confirm' ? (
        <ConfirmReserved plan={plan} onLaunch={onLaunch} onCancel={onCancel} />
      ) : (
        <WalkIn plan={plan} bayLabel={bayLabel} notice={notice} onLaunch={onLaunch} onCancel={onCancel} onReplan={onReplan} />
      )}
    </div>
  );
}

function ConfirmReserved({ plan, onLaunch, onCancel }: { plan: Extract<AskPlan, { mode: 'confirm' }>; onLaunch: () => void; onCancel: () => void }) {
  return (
    <div className="modal" style={{ textAlign: 'center' }}>
      <div className="modal-head" style={{ textAlign: 'center' }}>
        <div className="eyebrow">Reservation coming up</div>
        <h1>
          {bookingName(plan.next)} has this bay booked at {formatTime(plan.next.start, plan.timezone)}
        </h1>
        <p>Are you sure you would like to continue?</p>
      </div>
      <div className="modal-foot" style={{ justifyContent: 'center', borderTop: 'none', paddingTop: 28 }}>
        <button className="btn btn-lg" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary btn-lg" onClick={() => onLaunch()}>
          <PlayIcon size={22} /> Continue
        </button>
      </div>
    </div>
  );
}

function WalkIn({
  plan,
  bayLabel,
  notice,
  onLaunch,
  onCancel,
  onReplan,
}: {
  plan: Extract<AskPlan, { mode: 'walkin' }>;
  bayLabel: string;
  notice?: string | null;
  onLaunch: (note?: string) => void;
  onCancel: () => void;
  onReplan: (message: string) => void;
}) {
  const [choice, setChoice] = useState<{ minutes: number; end: string } | null>(null);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tz = plan.timezone;
  const digits = phone.replace(/\D/g, '');

  function key(k: string) {
    setErr(null);
    if (k === 'del') return setPhone((p) => p.replace(/\D/g, '').slice(0, -1));
    setPhone((p) => (p.replace(/\D/g, '') + k).slice(0, 10));
  }

  async function submit() {
    if (!choice || busy) return;
    if (digits.length < 10) return setErr('Enter your 10-digit phone number.');
    setBusy(true);
    setErr(null);
    const r = await kiosk.walkIn(choice.minutes, digits);
    setBusy(false);
    if (!isErr(r)) {
      const end = (r as { booking: { end: string } }).booking.end;
      return onLaunch(`${bayLabel} is reserved for you until ${formatTime(end, tz)}. Have a great round.`);
    }
    // Someone booked the bay while this player was choosing: start over with the new picture.
    if (r.status === 409 && r.code !== 'WALK_IN_OFF') return onReplan(r.error);
    // The player's own input.
    if (r.status === 400) return setErr(r.error);
    // Anything else (offline, server error, walk-ins switched off meanwhile) is not theirs to fix.
    onLaunch();
  }

  if (!choice) {
    return (
      <div className="modal">
        <div className="modal-head row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="eyebrow">{bayLabel}</div>
            <h1>How long would you like to play?</h1>
            <p>
              {plan.next
                ? `${bookingName(plan.next)} has this bay booked at ${formatTime(plan.next.start, tz)}, so that is the latest you can play.`
                : 'The bay will be reserved for you from now.'}
            </p>
          </div>
          <button className="btn btn-ghost" onClick={onCancel} aria-label="Cancel">
            <CloseIcon size={26} />
          </button>
        </div>
        <div className="modal-body">
          {notice && <div className="error" style={{ marginBottom: 16 }}>{notice}</div>}
          <div className="dur-grid">
            {plan.options.map((o) => (
              <button key={o.minutes} className="dur" onClick={() => setChoice(o)}>
                <strong>{durationLabel(o.minutes)}</strong>
                <span>until {formatTime(o.end, tz)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal">
      <div className="modal-head row between" style={{ alignItems: 'flex-start' }}>
        <button className="btn btn-ghost" disabled={busy} onClick={() => { setChoice(null); setErr(null); }} aria-label="Back">
          <BackIcon size={26} />
        </button>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div className="eyebrow">{durationLabel(choice.minutes)} · until {formatTime(choice.end, tz)}</div>
          <h1>What is your phone number?</h1>
          <p>{bayLabel} will be reserved under this number.</p>
        </div>
        <button className="btn btn-ghost" disabled={busy} onClick={onCancel} aria-label="Cancel">
          <CloseIcon size={26} />
        </button>
      </div>
      <div className="modal-body" style={{ textAlign: 'center' }}>
        <div style={{ maxWidth: 380, margin: '0 auto' }}>
          <input
            className="input input-xl"
            inputMode="tel"
            autoFocus
            placeholder="(555) 555-5555"
            value={formatPhoneInput(phone)}
            onChange={(e) => { setErr(null); setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
            <button key={k} className="key" onClick={() => key(k)}>{k}</button>
          ))}
          <button className="key" onClick={() => key('del')} aria-label="Delete"><DeleteIcon size={26} /></button>
          <button className="key" onClick={() => key('0')}>0</button>
          <span />
        </div>
        {err && <div className="error" style={{ marginTop: 16, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>{err}</div>}
      </div>
      <div className="modal-foot" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary btn-lg" disabled={busy || digits.length < 10} onClick={submit}>
          {busy ? <span className="spinner" /> : <PlayIcon size={22} />} Reserve and play
        </button>
      </div>
    </div>
  );
}
