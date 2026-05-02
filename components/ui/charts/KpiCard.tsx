"use client";
/**
 * Stat card with optional sparkline + delta. Use across dashboards for
 * consistent KPI presentation.
 */
import Link from "next/link";
import { Sparkline } from "./Sparkline";
import { CHART_COLORS } from "./theme";

export function KpiCard({
  label,
  value,
  hint,
  href,
  trend,
  trendColor = CHART_COLORS.blue,
  delta,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  trend?: { y: number }[];
  trendColor?: string;
  /** Signed percent change vs previous period; positive is green */
  delta?: number;
}) {
  const inner = (
    <div className="rounded-apple bg-white p-4 shadow-apple transition-shadow hover:shadow-apple-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">
            {label}
          </div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums text-apple-text">
            {value}
          </div>
          {hint && (
            <div className="mt-0.5 text-apple-xs text-apple-text-tertiary">{hint}</div>
          )}
        </div>
        {delta != null && (
          <span
            className={[
              "shrink-0 rounded-apple-pill px-2 py-0.5 text-[10px] font-semibold",
              delta > 0
                ? "bg-apple-green/10 text-apple-green"
                : delta < 0
                  ? "bg-apple-red/10 text-apple-red"
                  : "bg-apple-fill-secondary text-apple-text-tertiary",
            ].join(" ")}
          >
            {delta > 0 ? "+" : ""}
            {delta.toFixed(1)}%
          </span>
        )}
      </div>
      {trend && trend.length > 1 && (
        <div className="-mx-1 mt-3">
          <Sparkline data={trend} color={trendColor} height={36} />
        </div>
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
