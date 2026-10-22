"use client";
import {
  ResponsiveContainer,
  BarChart as RcBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from "recharts";
import {
  CHART_AXIS_STYLE,
  CHART_GRID_STYLE,
  CHART_TOOLTIP_STYLE,
  paletteFor,
  resolveYFormatter,
  type YFormat,
} from "./theme";
import type { LineSeries } from "./LineChart";

export function BarChart({
  data,
  xKey,
  series,
  height = 240,
  yFormatter: yFormatterProp,
  yFormat,
  stacked = false,
  layout = "horizontal",
  showLegend = false,
  colorByCell,
}: {
  data: Array<Record<string, any>>;
  xKey: string;
  series: LineSeries[];
  height?: number;
  /** Client-only: custom formatter. From server components use `yFormat` instead. */
  yFormatter?: (v: number) => string;
  /** Serializable axis format, safe to pass from server components. */
  yFormat?: YFormat;
  stacked?: boolean;
  layout?: "horizontal" | "vertical";
  showLegend?: boolean;
  /** When true and a single series is passed, each bar gets its own palette color. */
  colorByCell?: boolean;
}) {
  const yFormatter = resolveYFormatter(yFormat, yFormatterProp);
  const palette = paletteFor(Math.max(series.length, data.length));
  const isVertical = layout === "vertical";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RcBarChart
        data={data}
        layout={layout}
        margin={{ top: 8, right: 16, bottom: 0, left: isVertical ? 8 : -8 }}
      >
        <CartesianGrid {...CHART_GRID_STYLE} vertical={isVertical} horizontal={!isVertical} />
        {isVertical ? (
          <>
            <XAxis
              type="number"
              tick={CHART_AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              tickFormatter={yFormatter}
            />
            <YAxis
              type="category"
              dataKey={xKey as any}
              tick={CHART_AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              width={120}
            />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey as any} tick={CHART_AXIS_STYLE} tickLine={false} axisLine={false} />
            <YAxis
              tick={CHART_AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              tickFormatter={yFormatter}
            />
          </>
        )}
        <Tooltip
          {...CHART_TOOLTIP_STYLE}
          cursor={{ fill: "#F2F2F7" }}
          formatter={(v: any) => (yFormatter ? yFormatter(Number(v)) : v)}
        />
        {showLegend && <Legend wrapperStyle={CHART_AXIS_STYLE} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key as any}
            name={s.label}
            stackId={stacked ? "1" : undefined}
            fill={s.color ?? palette[i]}
            radius={isVertical ? [0, 6, 6, 0] : [6, 6, 0, 0]}
          >
            {colorByCell && series.length === 1
              ? data.map((_, idx) => <Cell key={idx} fill={palette[idx]} />)
              : null}
          </Bar>
        ))}
      </RcBarChart>
    </ResponsiveContainer>
  );
}
