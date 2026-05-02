"use client";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import { CHART_AXIS_STYLE, CHART_TOOLTIP_STYLE, paletteFor, STATUS_COLORS } from "./theme";

export type DonutSlice = {
  name: string;
  value: number;
  color?: string;
};

export function DonutChart({
  data,
  height = 240,
  centerLabel,
  centerValue,
  innerRadius = 60,
  outerRadius = 100,
  useStatusColors = false,
  showLegend = true,
}: {
  data: DonutSlice[];
  height?: number;
  centerLabel?: string;
  centerValue?: string;
  innerRadius?: number;
  outerRadius?: number;
  useStatusColors?: boolean;
  showLegend?: boolean;
}) {
  const palette = paletteFor(data.length);
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d, i) => {
              const fill =
                d.color ??
                (useStatusColors && STATUS_COLORS[d.name]
                  ? STATUS_COLORS[d.name]
                  : palette[i]);
              return <Cell key={i} fill={fill} />;
            })}
          </Pie>
          <Tooltip
            {...CHART_TOOLTIP_STYLE}
            formatter={(v: any, name: any) => {
              const pct = total > 0 ? ((Number(v) / total) * 100).toFixed(1) : "0";
              return [`${v} (${pct}%)`, name];
            }}
          />
          {showLegend && (
            <Legend
              verticalAlign="bottom"
              wrapperStyle={CHART_AXIS_STYLE}
              iconType="circle"
              iconSize={8}
            />
          )}
        </PieChart>
      </ResponsiveContainer>

      {(centerLabel || centerValue) && (
        <div
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
          style={{
            paddingBottom: showLegend ? 28 : 0,
          }}
        >
          {centerValue && (
            <div className="text-apple-2xl font-semibold tabular-nums text-apple-text">
              {centerValue}
            </div>
          )}
          {centerLabel && (
            <div className="mt-0.5 text-apple-xs text-apple-text-tertiary">{centerLabel}</div>
          )}
        </div>
      )}
    </div>
  );
}
