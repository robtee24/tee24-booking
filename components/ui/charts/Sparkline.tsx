"use client";
/**
 * Tiny inline trend chart for use inside KPI cards.
 *
 * No axes, no tooltip — just a colored area. Usage:
 *   <Sparkline data={[{ y: 4 }, { y: 6 }, { y: 5 }]} />
 */
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { CHART_COLORS } from "./theme";

export function Sparkline({
  data,
  color = CHART_COLORS.blue,
  height = 32,
}: {
  data: { y: number }[];
  color?: string;
  height?: number;
}) {
  if (!data || data.length === 0) {
    return <div style={{ height }} />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`spark-grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="y"
          stroke={color}
          strokeWidth={1.75}
          fill={`url(#spark-grad-${color})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
