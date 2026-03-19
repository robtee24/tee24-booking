import React, { useState, useEffect, useRef } from 'react';
import type { BookingInfo } from '../shared/types';

interface Props {
  booking: BookingInfo;
}

export default function WarningBar({ booking }: Props) {
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    const start = new Date(booking.start).getTime();
    return Math.max(0, Math.floor((start - Date.now()) / 1000));
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      const start = new Date(booking.start).getTime();
      const remaining = Math.max(0, Math.floor((start - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [booking.start]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timeDisplay = `${minutes}:${String(seconds).padStart(2, '0')}`;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 48,
      background: 'linear-gradient(135deg, #ff3b30 0%, #d70015 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      color: '#ffffff',
      fontSize: 14,
      fontWeight: 600,
      letterSpacing: '0.01em',
      boxShadow: '0 2px 12px rgba(255, 59, 48, 0.4)',
    }}>
      <span>Next reservation starts in</span>
      <span style={{
        fontVariantNumeric: 'tabular-nums',
        fontSize: 16,
        fontWeight: 700,
        background: 'rgba(255, 255, 255, 0.2)',
        padding: '2px 10px',
        borderRadius: 6,
      }}>
        {timeDisplay}
      </span>
      <span>minutes</span>
    </div>
  );
}
