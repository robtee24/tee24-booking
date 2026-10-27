import { useEffect, useState } from 'react';
import { kiosk, isErr, useKioskState, useServerNow, formatCountdown, formatTime, formatPhoneInput } from '../shared/bridge';
import type { Booking, KioskState } from '../shared/types';
import { TroubleshootFlow } from '../shared/TroubleshootFlow';
import { ScheduleView } from '../shared/ScheduleView';
import { ExportFlow } from '../shared/ExportFlow';
import { PlayersFlow } from './PlayersFlow';
import { CloseIcon, LockIcon, DeleteIcon, CheckIcon } from '../shared/Icons';

/**
 * Transparent always-on-top overlay. Shows exactly one modal at a time, driven
 * by main's state machine: unlock → upcoming → help/schedule/export (user-initiated).
 */
export function App() {
  const state = useKioskState();
  const now = useServerNow(state?.serverOffsetMs ?? 0);
  if (!state || state.overlay.mode === 'none') return null;

  const { mode, booking, deadline } = state.overlay;
  const tz = state.status?.location.timezone;

  return (
    <div className="overlay">
      {mode === 'unlock' && booking && deadline && <Unlock booking={booking} deadline={deadline} now={now} tz={tz} />}
      {mode === 'upcoming' && booking && <Upcoming booking={booking} now={now} tz={tz} state={state} />}
      {mode === 'help' && (
        <Modal title="Help" eyebrow="Troubleshooting" wide onClose={() => kiosk.openOverlay('none')}>
          <TroubleshootFlow startAt="entry" />
        </Modal>
      )}
      {mode === 'schedule' && (
        <Modal title={`Bay ${state.settings.bayNumber ?? ''} schedule`} eyebrow={state.settings.locationName ?? 'Tee24'} wide onClose={() => kiosk.openOverlay('none')}>
          <ScheduleView serverOffsetMs={state.serverOffsetMs} />
        </Modal>
      )}
      {mode === 'export' && (
        <Modal title="Send your shot data" eyebrow="GSPro export → Tee24" wide onClose={() => kiosk.openOverlay('none')}>
          <ExportFlow currentBooking={state.status?.currentBooking ?? null} onClose={() => kiosk.openOverlay('none')} />
        </Modal>
      )}
      {mode === 'idle' && deadline && <IdleWarning deadline={deadline} minutes={state.settings.idleCloseMinutes} />}
      {mode === 'players' && (state.players.alert || state.players.done) && (
        <PlayersFlow
          alert={(state.players.alert ?? state.players.done)!}
          done={!state.players.alert && !!state.players.done}
          allowance={state.players.allowance}
          booking={booking}
        />
      )}
    </div>
  );
}

// ---------- Idle: no input for a while; GSPro closes unless someone taps ----------

function IdleWarning({ deadline, minutes }: { deadline: string; minutes: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = new Date(deadline).getTime() - now;
  return (
    <div className="modal" style={{ textAlign: 'center' }}>
      <div className="modal-head" style={{ textAlign: 'center' }}>
        <div className="eyebrow">Still playing?</div>
        <h1>No activity for {minutes} {minutes === 1 ? 'minute' : 'minutes'}</h1>
        <p>GSPro will close and this bay will reset unless someone taps the screen or moves the mouse.</p>
      </div>
      <div className="modal-body" style={{ textAlign: 'center' }}>
        <div className={`countdown-big ${left < 15_000 ? 'bad' : 'warn'}`}>{formatCountdown(left)}</div>
        <div className="tiny" style={{ marginTop: 6 }}>until GSPro closes</div>
      </div>
      <div className="modal-foot" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary btn-lg" onClick={() => kiosk.openOverlay('none')}>
          Keep playing
        </button>
      </div>
    </div>
  );
}

function Modal({ title, eyebrow, children, onClose, wide, footer }: { title: string; eyebrow?: string; children: React.ReactNode; onClose?: () => void; wide?: boolean; footer?: React.ReactNode }) {
  return (
    <div className={`modal ${wide ? 'modal-wide' : ''}`}>
      <div className="modal-head row between" style={{ alignItems: 'flex-start' }}>
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
        </div>
        {onClose && (
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close"><CloseIcon size={26} /></button>
        )}
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </div>
  );
}

// ---------- Unlock: reservation has started; member enters phone ----------

function Unlock({ booking, deadline, now, tz }: { booking: Booking; deadline: string; now: number; tz?: string }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const left = new Date(deadline).getTime() - now;
  const digits = phone.replace(/\D/g, '');

  useEffect(() => {
    // New booking → reset form
    setPhone('');
    setErr(null);
    setDone(false);
  }, [booking.id]);

  async function submit() {
    if (digits.length < 10) return setErr('Enter the 10-digit phone number used for the reservation.');
    setBusy(true);
    setErr(null);
    const r = await kiosk.checkIn(booking.id, digits);
    setBusy(false);
    if (isErr(r)) return setErr(r.status === 403 ? 'That number doesn’t match this reservation. Try the number you booked with.' : r.error);
    setDone(true);
  }

  function key(k: string) {
    if (k === 'del') return setPhone((p) => p.replace(/\D/g, '').slice(0, -1));
    setPhone((p) => (p.replace(/\D/g, '') + k).slice(0, 10));
  }

  if (done) {
    return (
      <div className="modal" style={{ textAlign: 'center', padding: 48 }}>
        <div style={{ width: 88, height: 88, borderRadius: '50%', background: 'rgba(34,197,94,0.2)', color: '#86efac', display: 'grid', placeItems: 'center', margin: '0 auto 20px' }}>
          <CheckIcon size={44} />
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 800 }}>You’re all set, {booking.firstName}!</h1>
        <p className="muted" style={{ marginTop: 10, fontSize: 20 }}>Bay unlocked until {formatTime(booking.end, tz)}. Have a great round.</p>
      </div>
    );
  }

  return (
    <div className="modal">
      <div className="modal-head" style={{ textAlign: 'center' }}>
        <div className="eyebrow">Reservation starting</div>
        <h1>Reservation for {booking.firstName} {booking.lastInitial}.</h1>
        <p>{formatTime(booking.start, tz)} – {formatTime(booking.end, tz)} · Enter the phone number you booked with to unlock the bay.</p>
      </div>
      <div className="modal-body" style={{ textAlign: 'center' }}>
        <div className={`countdown-big ${left < 60_000 ? 'bad' : left < 180_000 ? 'warn' : ''}`}>{formatCountdown(left)}</div>
        <div className="tiny" style={{ marginTop: 6 }}>to unlock before this reservation is released</div>

        <div style={{ maxWidth: 380, margin: '22px auto 0' }}>
          <input
            className="input input-xl"
            inputMode="tel"
            autoFocus
            placeholder="(555) 555-5555"
            value={formatPhoneInput(phone)}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
            <button key={k} className="key" onClick={() => key(k)}>{k}</button>
          ))}
          <button className="key" onClick={() => key('del')} aria-label="Delete"><DeleteIcon size={26} /></button>
          <button className="key" onClick={() => key('0')}>0</button>
          <button className="key" style={{ background: 'var(--green)', color: '#052e16' }} disabled={busy || digits.length < 10} onClick={submit} aria-label="Unlock">
            {busy ? <span className="spinner" /> : <LockIcon size={26} />}
          </button>
        </div>
        {err && <div className="error" style={{ marginTop: 16, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>{err}</div>}
      </div>
    </div>
  );
}

// ---------- Upcoming: heads-up N minutes before a reservation ----------

function Upcoming({ booking, now, tz, state }: { booking: Booking; now: number; tz?: string; state: KioskState }) {
  const left = new Date(booking.start).getTime() - now;
  const mins = Math.max(1, Math.ceil(left / 60_000));
  const warn = state.status?.location.bayAppWarningMinutes ?? 10;
  return (
    <div className="modal">
      <div className="modal-head" style={{ textAlign: 'center' }}>
        <div className="eyebrow">Heads up</div>
        <h1>Reservation in {mins} min for {booking.firstName} {booking.lastInitial}.</h1>
        <p>This bay is reserved from {formatTime(booking.start, tz)} to {formatTime(booking.end, tz)}. Please wrap up your round so the bay is ready on time.</p>
      </div>
      <div className="modal-body" style={{ textAlign: 'center' }}>
        <div className={`countdown-big ${left < 120_000 ? 'bad' : left < 300_000 ? 'warn' : ''}`}>{formatCountdown(left)}</div>
        <div className="tiny" style={{ marginTop: 6 }}>until the reservation starts (notified {warn} minutes ahead)</div>
      </div>
      <div className="modal-foot" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary btn-lg" onClick={() => kiosk.acceptUpcoming(booking.id)}>
          Got it — show a countdown
        </button>
      </div>
    </div>
  );
}
