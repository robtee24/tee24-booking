import { useEffect, useState } from 'react';
import { kiosk, isErr, formatTime, bookingName } from '../shared/bridge';
import type { ScheduleResponse } from '../shared/types';

const REFRESH_MS = 60_000;

/**
 * The rest of today's reservations for this bay, under the Play and Setup Help
 * tiles: the one running now (if any) and the ones still to come. A
 * reservation drops off the list the moment it ends.
 *
 * Refreshes every minute and whenever `refreshKey` changes (a session started
 * or ended, a walk-in was just booked). Keeps showing the last good list if a
 * refresh fails, so a network blip does not blank it.
 */
export function TodaySchedule({ now, bayNumber, refreshKey }: { now: number; bayNumber: number | null; refreshKey: string }) {
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      kiosk.getSchedule().then((r) => {
        if (!alive) return;
        if (isErr(r)) return setFailed(true);
        setFailed(false);
        setData(r as ScheduleResponse);
      });
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refreshKey]);

  const tz = data?.timezone;
  const remaining = data?.bookings.filter((b) => new Date(b.end).getTime() > now) ?? [];
  return (
    <section className="home-sched" aria-label="Today's schedule">
      <div className="home-sched-head">
        <span>Today’s schedule{bayNumber ? ` · Bay ${bayNumber}` : ''}</span>
        {remaining.length > 0 && (
          <span className="home-sched-count">
            {remaining.length} {remaining.length === 1 ? 'reservation' : 'reservations'}
          </span>
        )}
      </div>
      {!data ? (
        <div className="home-sched-empty">{failed ? 'The schedule is not available right now.' : 'Loading today’s schedule…'}</div>
      ) : remaining.length === 0 ? (
        <div className="home-sched-empty">{data.bookings.length === 0 ? 'No reservations today. This bay is open.' : 'No more reservations today. This bay is open.'}</div>
      ) : (
        <ul className="home-sched-list">
          {remaining.map((b) => {
            const isNow = new Date(b.start).getTime() <= now;
            return (
              <li key={b.id} className={isNow ? 'now' : ''}>
                <span className="time">
                  {formatTime(b.start, tz)} – {formatTime(b.end, tz)}
                </span>
                <span className="who">{bookingName(b)}</span>
                <span className={`badge ${isNow ? 'badge-ok' : ''}`}>{isNow ? (b.checkedIn ? 'In session' : 'Starting now') : 'Reserved'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
