import React, { useEffect, useState } from 'react';
import type { BayStatus } from '../shared/types';
import WarningBar from './WarningBar';

export default function App() {
  const [status, setStatus] = useState<BayStatus | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unsub1 = window.bayApp.onShowWarning((data: BayStatus) => {
      setStatus(data);
      setVisible(true);
    });
    const unsub2 = window.bayApp.onHideWarning(() => {
      setVisible(false);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  if (!visible || !status || !status.nextBooking) return null;

  return <WarningBar booking={status.nextBooking} />;
}
