import { useState, type FormEvent } from 'react';
import { kiosk, isErr, formatPhoneInput } from './bridge';
import type { AdminSession } from './types';

type Session = Omit<AdminSession, 'token'>;

/**
 * Admin sign-in by phone number. No text code: the bay PC sits behind the
 * member door, and the token only reaches this kiosk's own bay-app endpoints.
 * Only numbers on the Tee24 admin list are accepted by the server.
 */
export function AdminLogin({ onSignedIn, title = 'Admin sign-in', subtitle }: { onSignedIn: (s: Session) => void; title?: string; subtitle?: string }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = phone.replace(/\D/g, '');

  async function signIn(e?: FormEvent) {
    e?.preventDefault();
    if (digits.length < 10) return setError('Enter your 10-digit phone number.');
    setBusy(true);
    setError(null);
    const r = await kiosk.adminSignIn(digits);
    setBusy(false);
    if (isErr(r)) return setError(r.error);
    onSignedIn(r as Session);
  }

  return (
    <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div className="card-title">{title}</div>
      <div className="card-sub">{subtitle ?? 'Only phone numbers on the Tee24 admin list can sign in.'}</div>

      <form onSubmit={signIn} className="stack" style={{ marginTop: 20 }}>
        <div className="field">
          <label className="label" htmlFor="admin-phone">Admin phone number</label>
          <input
            id="admin-phone"
            className="input input-xl"
            inputMode="tel"
            autoFocus
            placeholder="(555) 555-5555"
            value={formatPhoneInput(phone)}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy || digits.length < 10}>
          {busy ? <span className="spinner" /> : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
