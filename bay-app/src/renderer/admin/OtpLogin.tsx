import React, { useState } from 'react';

interface Props {
  locationId: string;
  locationName: string;
  onVerified: () => void;
  onBack: () => void;
}

export default function OtpLogin({ locationId, locationName, onVerified, onBack }: Props) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendOtp() {
    if (!phone.trim()) return;
    try {
      setLoading(true);
      setError(null);
      await window.bayApp.apiRequest('POST', '/api/bay-app/auth', {
        action: 'send-otp',
        phone: phone.trim(),
      });
      setCodeSent(true);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to send code');
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    if (!code.trim()) return;
    try {
      setLoading(true);
      setError(null);
      const result = await window.bayApp.apiRequest('POST', '/api/bay-app/auth', {
        action: 'verify-otp',
        phone: phone.trim(),
        code: code.trim(),
        locationId,
      });
      if (result.ok) {
        onVerified();
      } else {
        setError(result.error ?? 'Verification failed');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Admin Login</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
        Verify admin access to <strong>{locationName}</strong>
      </p>

      {!codeSent ? (
        <>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
            Admin Phone Number
          </label>
          <input
            className="input"
            type="tel"
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendOtp()}
          />
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button className="btn-secondary" style={{ flex: 1 }} onClick={onBack}>Back</button>
            <button className="btn-primary" style={{ flex: 1 }} onClick={sendOtp} disabled={loading || !phone.trim()}>
              {loading ? 'Sending...' : 'Send Code'}
            </button>
          </div>
        </>
      ) : (
        <>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
            Enter 6-digit code
          </label>
          <input
            className="input"
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && verifyOtp()}
            style={{ letterSpacing: '0.3em', textAlign: 'center', fontSize: 20 }}
          />
          <p style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            Code sent to {phone}
          </p>
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => { setCodeSent(false); setCode(''); setError(null); }}>
              Resend
            </button>
            <button className="btn-primary" style={{ flex: 1 }} onClick={verifyOtp} disabled={loading || code.length !== 6}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
