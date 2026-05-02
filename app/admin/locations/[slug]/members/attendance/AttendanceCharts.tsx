"use client";

import React from "react";

type Day = { date: string; count: number };

export function AttendanceHeatmap({ data }: { data: Day[] }) {
  // Group by week (53 cols) × 7 rows, GitHub-style
  const max = Math.max(1, ...data.map((d) => d.count));
  const cellSize = 12;
  const gap = 2;

  // Find the day-of-week of the first date
  const startDow = new Date(data[0].date).getDay();
  const grid: (Day | null)[][] = [];
  let week: (Day | null)[] = Array.from({ length: startDow }, () => null);
  for (const d of data) {
    week.push(d);
    if (week.length === 7) {
      grid.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    grid.push(week);
  }

  return (
    <div className="inline-block">
      <svg
        width={grid.length * (cellSize + gap)}
        height={7 * (cellSize + gap)}
        role="img"
        aria-label="Attendance heatmap"
      >
        {grid.map((wk, x) =>
          wk.map((d, y) => {
            if (!d) return null;
            const intensity = d.count / max;
            const fill =
              d.count === 0
                ? "#e5e7eb"
                : `rgba(22, 163, 74, ${0.2 + intensity * 0.8})`;
            return (
              <rect
                key={`${x}-${y}`}
                x={x * (cellSize + gap)}
                y={y * (cellSize + gap)}
                width={cellSize}
                height={cellSize}
                rx={2}
                fill={fill}
              >
                <title>{`${d.date}: ${d.count} visit${d.count === 1 ? "" : "s"}`}</title>
              </rect>
            );
          })
        )}
      </svg>
    </div>
  );
}

export function TimeOfDayChart({ data }: { data: Array<{ hour: number; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1 h-40">
      {data.map((d) => (
        <div key={d.hour} className="flex flex-col items-center gap-1 flex-1">
          <div
            className="w-full bg-apple-blue/80 rounded-t-sm"
            style={{ height: `${(d.count / max) * 100}%` }}
            title={`${d.hour}:00 — ${d.count} visit${d.count === 1 ? "" : "s"}`}
          />
          <div className="text-[10px] text-apple-text-tertiary">
            {d.hour % 6 === 0 ? `${d.hour}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
