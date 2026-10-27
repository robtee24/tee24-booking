import { useEffect, useState } from 'react';
import { kiosk, isErr, formatPhoneInput } from '../shared/bridge';
import type { PlayersAlert, PlayerAllowance, Booking } from '../shared/types';
import { DeleteIcon, CheckIcon } from '../shared/Icons';

/**
 * Too-many-players modal. Shown by main when GSPro has more players than the
 * current reservation allows, either on the Round Settings screen (SETUP) or
 * during a round (ROUND). Three ways out:
 *   1. fix it in GSPro (remove a player / exit the game),
 *   2. "Other players are members" → identify them by phone, which raises the
 *      allowance (their guest privileges count too),
 *   3. tick the box and proceed → charged per extra guest and the admin
 *      console is alerted. Exiting is also reported (timestamped, no charge),
 *      and the bay relaunches as if Play had been pressed.
 */
export function PlayersFlow({ alert, done, allowance, booking }: { alert: PlayersAlert; done: boolean; allowance: PlayerAllowance | null; booking: Booking | null }) {
  const [view, setView] = useState<'warn' | 'members'>('warn');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset if the situation changes (different count or screen).
  useEffect(() => {
    setView('warn');
    setAgree(false);
    setErr(null);
  }, [alert.bookingId, alert.screen]);

  const fee = `$${Math.round(alert.feeCents / alert.extraGuests / 100)}`;
  const isSetup = alert.screen === 'SETUP';
  const extra = alert.extraGuests;

  async function proceed() {
    setBusy(true);
    setErr(null);
    // On success main flips the state to `done`, which renders the thanks view below.
    const r = await kiosk.playersProceed();
    setBusy(false);
    if (isErr(r)) return setErr(r.error);
  }

  async function exitGame() {
    setBusy(true);
    const r = await kiosk.playersExitGame();
    setBusy(false);
    if (isErr(r)) setErr(r.error);
  }

  if (done) {
    return (
      <div className="modal" style={{ textAlign: 'center', padding: 48 }}>
        <div style={{ width: 88, height: 88, borderRadius: '50%', background: 'rgba(34,197,94,0.2)', color: '#86efac', display: 'grid', placeItems: 'center', margin: '0 auto 20px' }}>
          <CheckIcon size={44} />
        </div>
        <h1 style={{ fontSize: 34, fontWeight: 800 }}>Thanks — you’re good to go</h1>
        <p className="muted" style={{ marginTop: 10, fontSize: 20 }}>
          {extra} additional {extra === 1 ? 'guest' : 'guests'} ({fee} each) will be added to the account on file. Enjoy your round.
        </p>
        <div className="modal-foot" style={{ justifyContent: 'center', marginTop: 28 }}>
          <button className="btn btn-primary btn-lg" onClick={() => kiosk.playersDismiss()}>Back to GSPro</button>
        </div>
      </div>
    );
  }

  if (view === 'members') {
    return (
      <MembersView
        alert={alert}
        allowance={allowance}
        booking={booking}
        onBack={() => setView('warn')}
      />
    );
  }

  return (
    <div className="modal">
      <div className="modal-head" style={{ textAlign: 'center' }}>
        <div className="eyebrow">{isSetup ? 'Round settings' : 'Players on this bay'}</div>
        <h1>
          {isSetup
            ? `Your account only allows ${alert.allowedPlayers} ${alert.allowedPlayers === 1 ? 'player' : 'players'}`
            : `There are too many players on this bay`}
        </h1>
        <p>
          {isSetup ? (
            <>
              GSPro has <b>{alert.playerCount}</b> players set up, but this reservation covers <b>{alert.allowedPlayers}</b> ({booking?.firstName ?? 'the member'}
              {alert.allowedPlayers > 1 ? ` + ${alert.allowedPlayers - 1} ${alert.allowedPlayers - 1 === 1 ? 'guest' : 'guests'}` : ', no guests'}).
              If you proceed, your account will be charged <b>{fee} per additional unauthorized guest</b>.
            </>
          ) : (
            <>
              This round has <b>{alert.playerCount}</b> players, but this reservation covers <b>{alert.allowedPlayers}</b>. You can exit the game now, or if you
              continue you’ll be charged an additional <b>{fee} per unauthorized guest</b>.
            </>
          )}
        </p>
      </div>

      <div className="modal-body">
        <div className="players-summary">
          <div className="players-stat">
            <div className="players-stat-num">{alert.playerCount}</div>
            <div className="players-stat-label">players in GSPro</div>
          </div>
          <div className="players-stat">
            <div className="players-stat-num ok">{alert.allowedPlayers}</div>
            <div className="players-stat-label">allowed on this reservation</div>
          </div>
          <div className="players-stat">
            <div className="players-stat-num bad">+{extra}</div>
            <div className="players-stat-label">
              unauthorized · {`$${alert.feeCents / 100}`} total
            </div>
          </div>
        </div>

        <label className={`agree ${agree ? 'on' : ''}`}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span className="agree-box" aria-hidden>{agree && <CheckIcon size={20} />}</span>
          <span>
            I understand my account will be charged <b>{fee}</b> for each additional unauthorized guest ({extra} × {fee} = ${alert.feeCents / 100}).
          </span>
        </label>

        {err && <div className="error" style={{ marginTop: 14 }}>{err}</div>}
      </div>

      <div className="modal-foot players-actions">
        <button className="btn btn-lg" disabled={busy} onClick={() => setView('members')}>
          Other players are members
        </button>
        {isSetup ? (
          <button className="btn btn-lg" disabled={busy} onClick={() => kiosk.playersSnooze()}>
            Remove a player
          </button>
        ) : (
          <button className="btn btn-lg btn-danger" disabled={busy} onClick={exitGame}>
            Exit the game
          </button>
        )}
        <button className="btn btn-primary btn-lg" disabled={!agree || busy} onClick={proceed}>
          {busy ? <span className="spinner" /> : isSetup ? `Proceed (${fee}/guest)` : `Continue (${fee}/guest)`}
        </button>
      </div>
    </div>
  );
}

// ---------- "Other players are members": phone entry, repeatable ----------

function MembersView({ alert, allowance, booking, onBack }: { alert: PlayersAlert; allowance: PlayerAllowance | null; booking: Booking | null; onBack: () => void }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>(() => allowance?.companions.map((c) => `${c.firstName} ${c.lastInitial}.`) ?? []);
  // Latest server answer, kept locally so the numbers update before main's next state push lands.
  const [latest, setLatest] = useState<PlayerAllowance | null>(null);
  const digits = phone.replace(/\D/g, '');

  const allowedNow = Math.max(alert.allowedPlayers, allowance?.allowedPlayers ?? 0, latest?.allowedPlayers ?? 0);
  const stillOver = alert.playerCount - allowedNow;

  async function submit() {
    if (digits.length < 10) return setErr('Enter the member’s 10-digit phone number.');
    setBusy(true);
    setErr(null);
    const r = await kiosk.playersAddMember(digits);
    setBusy(false);
    if (isErr(r)) {
      const msg =
        r.code === 'MEMBER_NOT_FOUND' ? 'No member with that phone number. Check the number, or they can join as a guest.' :
        r.code === 'MEMBER_NOT_ACTIVE' ? 'That member doesn’t have an active membership, so they count as a guest.' :
        r.code === 'IS_BOOKER' ? `That’s ${booking?.firstName ?? 'the member'}’s own number — enter the other player’s number.` :
        r.error;
      return setErr(msg);
    }
    setPhone('');
    setLatest(r as PlayerAllowance);
    if (r.added) setAdded((a) => [...a, `${r.added!.firstName} ${r.added!.lastInitial}.`]);
  }

  function key(k: string) {
    if (k === 'del') return setPhone((p) => p.replace(/\D/g, '').slice(0, -1));
    setPhone((p) => (p.replace(/\D/g, '') + k).slice(0, 10));
  }

  return (
    <div className="modal">
      <div className="modal-head" style={{ textAlign: 'center' }}>
        <div className="eyebrow">Other players are members</div>
        <h1>Enter the member’s phone number</h1>
        <p>
          Each member you add counts toward this bay along with their own guest allowance. One at a time — the number they use for their Tee24 account.
        </p>
      </div>
      <div className="modal-body" style={{ textAlign: 'center' }}>
        <div className="players-summary" style={{ marginBottom: 18 }}>
          <div className="players-stat">
            <div className="players-stat-num">{alert.playerCount}</div>
            <div className="players-stat-label">players in GSPro</div>
          </div>
          <div className="players-stat">
            <div className={`players-stat-num ${stillOver <= 0 ? 'ok' : ''}`}>{allowedNow}</div>
            <div className="players-stat-label">allowed on this bay</div>
          </div>
          <div className="players-stat">
            <div className={`players-stat-num ${stillOver <= 0 ? 'ok' : 'bad'}`}>{stillOver <= 0 ? '✓' : `+${stillOver}`}</div>
            <div className="players-stat-label">{stillOver <= 0 ? 'all players covered' : 'still unauthorized'}</div>
          </div>
        </div>

        {added.length > 0 && (
          <div className="success" style={{ marginBottom: 14, textAlign: 'left' }}>
            Members on this bay: <b>{booking?.firstName ?? 'Booker'}</b>, {added.map((n, i) => <b key={i}>{i > 0 ? ', ' : ''}{n}</b>)}
          </div>
        )}

        {stillOver <= 0 ? (
          <p className="muted" style={{ fontSize: 18 }}>Everyone is covered — this message will close on its own.</p>
        ) : (
          <>
            <div style={{ maxWidth: 380, margin: '0 auto' }}>
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
              <button className="key" style={{ background: 'var(--green)', color: '#052e16' }} disabled={busy || digits.length < 10} onClick={submit} aria-label="Add member">
                {busy ? <span className="spinner" /> : <CheckIcon size={26} />}
              </button>
            </div>
          </>
        )}
        {err && <div className="error" style={{ marginTop: 16, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>{err}</div>}
      </div>
      <div className="modal-foot" style={{ justifyContent: 'center' }}>
        <button className="btn btn-lg" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
