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
import { useRef, type SyntheticEvent } from "react";

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
  onBarClick,
  activeX,
  xTickFormatter,
  tooltipLabelFormatter,
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
  /** Client-only: called with the clicked row's data (any series). Makes bars clickable. */
  onBarClick?: (row: Record<string, unknown>) => void;
  /** xKey value to highlight (other bars are dimmed). */
  activeX?: string | number | null;
  /** Client-only: format x-axis tick labels. */
  xTickFormatter?: (v: string | number) => string;
  /** Client-only: format the tooltip title (x value). */
  tooltipLabelFormatter?: (v: string | number) => string;
}) {
  const yFormatter = resolveYFormatter(yFormat, yFormatterProp);
  const palette = paletteFor(Math.max(series.length, data.length));
  // Guard so a bar click (handled on the <Bar>) doesn't also fire the
  // chart-level fallback and toggle the selection twice.
  const lastBarClickAt = useRef(0);
  const isVertical = layout === "vertical";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RcBarChart
        data={data}
        layout={layout}
        margin={{ top: 8, right: 16, bottom: 0, left: isVertical ? 8 : -8 }}
        onClick={
          onBarClick
            ? (state) => {
                // Fallback for clicks on the gap/axis area of a column
                // (recharts 3 reports the hovered category index).
                if (Date.now() - lastBarClickAt.current < 300) return;
                const idx = state?.activeIndex;
                const row =
                  idx == null
                    ? undefined
                    : data[Number(idx)] ??
                      data.find((r) => String(r[xKey]) === String(state?.activeLabel));
                if (row) onBarClick(row);
              }
            : undefined
        }
        style={onBarClick ? { cursor: "pointer" } : undefined}
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
            <XAxis
              dataKey={xKey as any}
              tick={CHART_AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              tickFormatter={xTickFormatter}
              interval="preserveStartEnd"
              minTickGap={18}
            />
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
          labelFormatter={
            tooltipLabelFormatter
              ? (label) =>
                  typeof label === "string" || typeof label === "number"
                    ? tooltipLabelFormatter(label)
                    : label
              : undefined
          }
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
            cursor={onBarClick ? "pointer" : undefined}
            onClick={
              onBarClick
                ? (entry: { payload?: Record<string, unknown> }, idx: number, e: SyntheticEvent) => {
                    // Bar-level click doesn't depend on hover state, so it
                    // works for taps and programmatic clicks too.
                    e?.stopPropagation?.();
                    lastBarClickAt.current = Date.now();
                    const row = entry?.payload ?? data[idx];
                    if (row) onBarClick(row);
                  }
                : undefined
            }
          >
            {colorByCell && series.length === 1
              ? data.map((_, idx) => <Cell key={idx} fill={palette[idx]} />)
              : activeX != null
                ? data.map((row, idx) => (
                    <Cell key={idx} fillOpacity={row[xKey] === activeX ? 1 : 0.35} />
                  ))
                : null}
          </Bar>
        ))}
      </RcBarChart>
    </ResponsiveContainer>
  );
}
