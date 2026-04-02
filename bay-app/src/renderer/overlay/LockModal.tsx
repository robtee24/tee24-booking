import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { BookingInfo } from '../shared/types';

interface Props {
  booking: BookingInfo;
  unlockMinutes: number;
  autoCancelOnTimeout: boolean;
}

export default function LockModal({ booking, unlockMinutes, autoCancelOnTimeout }: Props) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    const bookingStart = new Date(booking.start).getTime();
    const deadline = bookingStart + unlockMinutes * 60 * 1000;
    return Math.max(0, Math.floor((deadline - Date.now()) / 1000));
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleTimeout = useCallback(async () => {
    try {
      const config = await window.bayApp.getConfig();
      await window.bayApp.apiRequest('POST', '/api/bay-app/cancel-timeout', {
        deviceId: config.deviceId,
        bookingId: booking.id,
      });
    } catch (e) {
      console.error('Cancel timeout error:', e);
    }
    window.bayApp.dismissOverlay();
  }, [booking.id]);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [handleTimeout]);

  async function handleUnlock() {
    if (!phone.trim()) return;
    try {
      setLoading(true);
      setError(null);
      const config = await window.bayApp.getConfig();
      const result = await window.bayApp.apiRequest('POST', '/api/bay-app/check-in', {
        deviceId: config.deviceId,
        bookingId: booking.id,
        phone: phone.trim(),
      });
      if (result.ok) {
        window.bayApp.dismissOverlay();
      } else {
        setError(result.error ?? 'Phone number does not match reservation');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Phone number does not match reservation');
    } finally {
      setLoading(false);
    }
  }

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timeDisplay = `${minutes}:${String(seconds).padStart(2, '0')}`;

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 20,
      padding: '48px 40px',
      width: '90%',
      maxWidth: 480,
      boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
      textAlign: 'center',
    }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        background: 'rgba(22, 163, 74, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 20px',
        fontSize: 24,
      }}>
        🔒
      </div>

      <h1 style={{
        fontSize: 22,
        fontWeight: 700,
        color: '#0f172a',
        marginBottom: 8,
        lineHeight: 1.3,
      }}>
        This Bay is Reserved For
      </h1>
      <p style={{
        fontSize: 26,
        fontWeight: 700,
        color: '#16a34a',
        marginBottom: 24,
      }}>
        {booking.firstName} {booking.lastName}
      </p>

      <p style={{
        fontSize: 14,
        color: '#64748b',
        marginBottom: 16,
      }}>
        Input Reservation Phone Number to Unlock
      </p>

      <input
        className="input"
        type="tel"
        placeholder="(555) 123-4567"
        value={phone}
        onChange={(e) => { setPhone(e.target.value); setError(null); }}
        onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
        style={{
          fontSize: 18,
          textAlign: 'center',
          letterSpacing: '0.05em',
          padding: '14px 16px',
        }}
        autoFocus
      />

      {error && (
        <p style={{ color: '#ff3b30', fontSize: 13, marginTop: 10 }}>{error}</p>
      )}

      <button
        className="btn-primary"
        onClick={handleUnlock}
        disabled={loading || !phone.trim()}
        style={{
          width: '100%',
          marginTop: 16,
          padding: '14px',
          fontSize: 16,
          fontWeight: 600,
          borderRadius: 10,
        }}
      >
        {loading ? 'Verifying...' : 'Unlock'}
      </button>

      <div style={{
        marginTop: 28,
        padding: '14px 16px',
        background: secondsLeft < 120 ? 'rgba(255, 59, 48, 0.06)' : 'rgba(0, 0, 0, 0.03)',
        borderRadius: 10,
      }}>
        <p style={{
          fontSize: 13,
          color: secondsLeft < 120 ? '#ff3b30' : '#94a3b8',
          lineHeight: 1.5,
        }}>
          This bay will unlock in{' '}
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{timeDisplay}</strong>
          {' '}minutes
          {autoCancelOnTimeout && ' and the reservation will be cancelled'}
        </p>
      </div>
    </div>
  );
}
