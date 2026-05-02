/**
 * Apple-style chart palette. Pulled from the Tee24 design tokens so charts feel
 * native to the rest of the admin UI.
 *
 * Use `paletteFor(n)` to get a stable, ordered list of `n` colors that won't
 * collide with status colors.
 */
export const CHART_COLORS = {
  blue: "#0A84FF",
  indigo: "#5E5CE6",
  purple: "#BF5AF2",
  pink: "#FF375F",
  red: "#FF453A",
  orange: "#FF9F0A",
  yellow: "#FFD60A",
  green: "#30D158",
  teal: "#64D2FF",
  gray: "#8E8E93",
} as const;

const PALETTE_ORDER = [
  CHART_COLORS.blue,
  CHART_COLORS.green,
  CHART_COLORS.orange,
  CHART_COLORS.purple,
  CHART_COLORS.teal,
  CHART_COLORS.pink,
  CHART_COLORS.indigo,
  CHART_COLORS.yellow,
  CHART_COLORS.red,
  CHART_COLORS.gray,
];

export function paletteFor(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(PALETTE_ORDER[i % PALETTE_ORDER.length]);
  return out;
}

/**
 * Status-aware colors so e.g. ACTIVE is always green and CANCELLED is always
 * red across every chart in the app.
 */
export const STATUS_COLORS: Record<string, string> = {
  ACTIVE: CHART_COLORS.green,
  PENDING: CHART_COLORS.yellow,
  FROZEN: CHART_COLORS.teal,
  CANCELLED: CHART_COLORS.gray,
  PAST_DUE: CHART_COLORS.orange,
  FAILED: CHART_COLORS.red,
  PAID: CHART_COLORS.green,
  REFUNDED: CHART_COLORS.gray,
  SCHEDULED: CHART_COLORS.blue,
  VISITOR: CHART_COLORS.purple,
};

export const CHART_AXIS_STYLE = {
  fontSize: 11,
  fill: "#8E8E93",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif',
};

export const CHART_GRID_STYLE = {
  stroke: "#E5E5EA",
  strokeDasharray: "3 3",
};

export const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "#FFFFFF",
    border: "1px solid #E5E5EA",
    borderRadius: 12,
    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
    padding: "8px 12px",
    fontSize: 12,
  },
  labelStyle: {
    color: "#1C1C1E",
    fontWeight: 600,
    marginBottom: 4,
  },
  itemStyle: {
    color: "#3C3C43",
    padding: 0,
  },
} as const;
