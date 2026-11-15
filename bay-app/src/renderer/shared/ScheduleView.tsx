import { useEffect, useState } from 'react';
import { kiosk, isErr, formatTime, bookingName } from './bridge';
import type { ScheduleResponse } from './types';

/** Today's reservations for this bay (first name + last initial only). */
export function ScheduleView({ serverOffsetMs }: { serverOffsetMs: number }) {
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dayOffset, setDayOffset] = useState(0);

  useEffect(() => {
    let alive = true;
    setData(null);
    const base = new Date(Date.now() + serverOffsetMs);
    base.setDate(base.getDate() + dayOffset);
    const iso = dayOffset === 0 ? undefined : `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
    kiosk.getSchedule(iso).then((r) => {
      if (!alive) return;
      if (isErr(r)) return setError(r.error);
      setData(r as ScheduleResponse);
    });
    return () => {
      alive = false;
    };
  }, [dayOffset, serverOffsetMs]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="row muted"><span className="spinner" /> Loading schedule…</div>;

  const now = Date.now() + serverOffsetMs;
  const tz = data.timezone;
  const dayLabel = new Date(`${data.dateISO}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  // Reservations that have ended are not shown, so there is nothing to see on earlier days either.
  const remaining = data.bookings.filter((b) => new Date(b.end).getTime() > now);
  const earlierToday = dayOffset === 0 && data.bookings.length > 0;

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <button className="btn btn-sm" disabled={dayOffset <= 0} onClick={() => setDayOffset((d) => Math.max(0, d - 1))}>‹ Previous day</button>
        <div style={{ fontWeight: 700, fontSize: 20 }}>{dayLabel}{dayOffset === 0 ? ' (today)' : ''}</div>
        <button className="btn btn-sm" onClick={() => setDayOffset((d) => d + 1)}>Next day ›</button>
      </div>
      {remaining.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{earlierToday ? 'No more reservations today' : 'No reservations'}</div>
          <div className="muted">Bay {data.bay.number} is open {earlierToday ? 'for the rest of the day' : 'all day'}.</div>
        </div>
      ) : (
        <ul className="sched">
          {remaining.map((b) => {
            const isNow = new Date(b.start).getTime() <= now;
            return (
              <li key={b.id} className={isNow ? 'now' : ''}>
                <span className="time">{formatTime(b.start, tz)} – {formatTime(b.end, tz)}</span>
                <span style={{ fontSize: 20, fontWeight: 600 }}>{bookingName(b)}</span>
                <span className={`badge ${isNow ? 'badge-ok' : ''}`}>{isNow ? (b.checkedIn ? 'In session' : 'Starting now') : b.checkedIn ? 'Checked in' : 'Reserved'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
