"use client";
/**
 * Apple-style line chart wrapper around recharts. Use for time-series data.
 *
 * Pass `series` with one or more named lines and a shared x-axis key. The
 * component handles palette, axes, gridlines, and tooltip formatting.
 */
import {
  ResponsiveContainer,
  LineChart as RcLineChart,
  Line,
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

export type LineSeries = {
  key: string;
  label: string;
  color?: string;
};

export function LineChart({
  data,
  xKey,
  series,
  height = 240,
  yFormatter,
  showLegend = false,
}: {
  data: Array<Record<string, any>>;
  xKey: string;
  series: LineSeries[];
  height?: number;
  yFormatter?: (v: number) => string;
  showLegend?: boolean;
}) {
  const palette = paletteFor(series.length);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RcLineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
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
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key as any}
            name={s.label}
            stroke={s.color ?? palette[i]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </RcLineChart>
    </ResponsiveContainer>
  );
}
