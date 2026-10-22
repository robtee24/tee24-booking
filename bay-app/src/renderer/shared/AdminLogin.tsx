import { useState, type FormEvent } from 'react';
import { kiosk, isErr, formatPhoneInput } from './bridge';
import type { AdminSession } from './types';

type Session = Omit<AdminSession, 'token'>;

/**
 * Admin sign-in with a Quo (OpenPhone) text-message code. Only phone numbers
 * on an Admin record can sign in — the server silently ignores anyone else.
 */
export function AdminLogin({ onSignedIn, title = 'Admin sign-in', subtitle }: { onSignedIn: (s: Session) => void; title?: string; subtitle?: string }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = phone.replace(/\D/g, '');

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (digits.length < 10) return setError('Enter your 10-digit phone number.');
    setBusy(true);
    setError(null);
    const r = await kiosk.adminSendOtp(digits);
    setBusy(false);
    if (isErr(r)) return setError(r.error);
    setStep('code');
  }

  async function verify(e?: FormEvent) {
    e?.preventDefault();
    if (code.trim().length < 4) return setError('Enter the code from your text message.');
    setBusy(true);
    setError(null);
    const r = await kiosk.adminVerifyOtp(digits, code.trim());
    setBusy(false);
    if (isErr(r)) return setError(r.error);
    onSignedIn(r as Session);
  }

  return (
    <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div className="card-title">{title}</div>
      <div className="card-sub">{subtitle ?? 'Only Tee24 admins can sign in. We’ll text a one-time code to your phone.'}</div>

      {step === 'phone' ? (
        <form onSubmit={sendCode} className="stack" style={{ marginTop: 20 }}>
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
            {busy ? <span className="spinner" /> : 'Text me a code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="stack" style={{ marginTop: 20 }}>
          <div className="field">
            <label className="label" htmlFor="admin-code">Code sent to {formatPhoneInput(phone)}</label>
            <input
              id="admin-code"
              className="input input-xl"
              inputMode="numeric"
              autoFocus
              autoComplete="one-time-code"
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
            <div className="hint">If you don’t get a text within a minute, your number may not be on the admin list.</div>
          </div>
          {error && <div className="error">{error}</div>}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy || code.length < 4}>
            {busy ? <span className="spinner" /> : 'Verify'}
          </button>
          <div className="row between">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStep('phone'); setCode(''); setError(null); }}>
              Change number
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => sendCode()}>
              Resend code
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
