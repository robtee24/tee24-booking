import React, { useEffect, useState } from 'react';
import type { BayStatus } from '../shared/types';
import LockModal from './LockModal';

export default function App() {
  const [status, setStatus] = useState<BayStatus | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unsub1 = window.bayApp.onShowOverlay((data: BayStatus) => {
      setStatus(data);
      setVisible(true);
    });
    const unsub2 = window.bayApp.onHideOverlay(() => {
      setVisible(false);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  if (!visible || !status || !status.currentBooking) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.65)',
      backdropFilter: 'blur(8px)',
      WebkitAppRegion: 'no-drag',
    } as React.CSSProperties}>
      <LockModal
        booking={status.currentBooking}
        unlockMinutes={status.location.bayAppUnlockMinutes}
        autoCancelOnTimeout={status.location.bayAppAutoCancelOnTimeout}
      />
    </div>
  );
}
