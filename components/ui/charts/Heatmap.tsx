"use client";
/**
 * Day × week heatmap (e.g. attendance over the last N weeks).
 *
 * Pure SVG — no recharts dependency. Each cell's color intensity is based on
 * its value vs the dataset max. Hover shows the tooltip via native title.
 */
import { CHART_COLORS } from "./theme";

export type HeatmapCell = {
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** Numeric value to color by */
  value: number;
};

const WEEKS = 12;
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function Heatmap({
  cells,
  weeks = WEEKS,
  color = CHART_COLORS.green,
  cellSize = 14,
  gap = 3,
  endDate,
}: {
  cells: HeatmapCell[];
  weeks?: number;
  color?: string;
  cellSize?: number;
  gap?: number;
  /** End-aligned grid (defaults to today). */
  endDate?: Date;
}) {
  const end = endDate ?? new Date();
  const totalDays = weeks * 7;
  const start = new Date(end);
  start.setDate(end.getDate() - totalDays + 1);
  start.setHours(0, 0, 0, 0);

  const byDate = new Map<string, number>();
  let max = 0;
  for (const c of cells) {
    byDate.set(c.date, (byDate.get(c.date) ?? 0) + c.value);
    if ((byDate.get(c.date) ?? 0) > max) max = byDate.get(c.date)!;
  }
  if (max === 0) max = 1;

  const grid: { date: string; value: number }[][] = Array.from({ length: weeks }, () => []);
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const week = Math.floor(i / 7);
    const iso = d.toISOString().slice(0, 10);
    grid[week].push({ date: iso, value: byDate.get(iso) ?? 0 });
  }

  const width = weeks * (cellSize + gap) + 28;
  const height = 7 * (cellSize + gap) + 24;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label="Attendance heatmap">
        {/* Day labels (S M T W T F S) along the left edge */}
        {DAY_LABELS.map((label, i) => (
          <text
            key={i}
            x={0}
            y={i * (cellSize + gap) + cellSize - 2 + 16}
            fontSize="10"
            fill="#8E8E93"
            fontFamily='-apple-system, BlinkMacSystemFont, system-ui, sans-serif'
          >
            {label}
          </text>
        ))}
        {/* Cells */}
        {grid.map((week, wi) =>
          week.map((cell, di) => {
            const intensity = max > 0 ? cell.value / max : 0;
            const fill =
              cell.value === 0 ? "#F2F2F7" : tint(color, 0.15 + intensity * 0.85);
            return (
              <g key={`${wi}-${di}`}>
                <rect
                  x={28 + wi * (cellSize + gap)}
                  y={di * (cellSize + gap) + 16}
                  width={cellSize}
                  height={cellSize}
                  rx={3}
                  fill={fill}
                />
                <title>
                  {cell.date}: {cell.value}
                </title>
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}

/** Mix `color` with white by `t` ∈ [0,1] (0 = white, 1 = full color). */
function tint(color: string, t: number): string {
  const m = color.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return color;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  const blend = (c: number) => Math.round(255 + (c - 255) * t);
  return `rgb(${blend(r)}, ${blend(g)}, ${blend(b)})`;
}
