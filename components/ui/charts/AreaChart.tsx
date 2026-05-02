"use client";
import {
  ResponsiveContainer,
  AreaChart as RcAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  CHART_AXIS_STYLE,
  CHART_GRID_STYLE,
  CHART_TOOLTIP_STYLE,
  paletteFor,
} from "./theme";
import type { LineSeries } from "./LineChart";

export function AreaChart({
  data,
  xKey,
  series,
  height = 240,
  yFormatter,
  stacked = false,
  showLegend = false,
}: {
  data: Array<Record<string, any>>;
  xKey: string;
  series: LineSeries[];
  height?: number;
  yFormatter?: (v: number) => string;
  stacked?: boolean;
  showLegend?: boolean;
}) {
  const palette = paletteFor(series.length);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RcAreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
        <defs>
          {series.map((s, i) => {
            const color = s.color ?? palette[i];
            return (
              <linearGradient
                key={s.key}
                id={`area-grad-${s.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid {...CHART_GRID_STYLE} vertical={false} />
        <XAxis dataKey={xKey as any} tick={CHART_AXIS_STYLE} tickLine={false} axisLine={false} />
        <YAxis
          tick={CHART_AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={yFormatter}
        />
        <Tooltip
          {...CHART_TOOLTIP_STYLE}
          formatter={(v: any) => (yFormatter ? yFormatter(Number(v)) : v)}
        />
        {showLegend && <Legend wrapperStyle={CHART_AXIS_STYLE} />}
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key as any}
            name={s.label}
            stackId={stacked ? "1" : undefined}
            stroke={s.color ?? palette[i]}
            strokeWidth={2}
            fill={`url(#area-grad-${s.key})`}
          />
        ))}
      </RcAreaChart>
    </ResponsiveContainer>
  );
}
