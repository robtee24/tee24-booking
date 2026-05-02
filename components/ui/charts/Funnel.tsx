"use client";
/**
 * Conversion funnel chart. Each stage has a label, a count, and an optional
 * delta from the previous stage shown as a percentage.
 */
import { paletteFor, CHART_COLORS } from "./theme";

export type FunnelStage = {
  label: string;
  value: number;
  color?: string;
};

export function Funnel({ stages, height = 240 }: { stages: FunnelStage[]; height?: number }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  const palette = paletteFor(stages.length);

  return (
    <div className="space-y-2" style={{ minHeight: height }}>
      {stages.map((s, i) => {
        const pct = (s.value / max) * 100;
        const fromPrev =
          i > 0 && stages[i - 1].value > 0
            ? (s.value / stages[i - 1].value) * 100
            : null;
        const color = s.color ?? palette[i];
        return (
          <div key={s.label} className="space-y-1">
            <div className="flex items-baseline justify-between text-apple-sm">
              <span className="font-medium text-apple-text">{s.label}</span>
              <span className="tabular-nums text-apple-text-secondary">
                {s.value.toLocaleString()}
                {fromPrev != null && (
                  <span className="ml-2 text-apple-xs text-apple-text-tertiary">
                    {fromPrev.toFixed(1)}% from prev
                  </span>
                )}
              </span>
            </div>
            <div
              className="h-8 rounded-apple-sm transition-all"
              style={{
                width: `${Math.max(pct, 2)}%`,
                backgroundColor: color,
                opacity: 0.85,
              }}
            />
          </div>
        );
      })}
      {stages.length >= 2 && stages[0].value > 0 && (
        <div className="pt-2 text-apple-xs text-apple-text-tertiary">
          Overall conversion:{" "}
          <span className="font-semibold text-apple-text">
            {((stages[stages.length - 1].value / stages[0].value) * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

export const FUNNEL_DEFAULT_COLOR = CHART_COLORS.blue;
