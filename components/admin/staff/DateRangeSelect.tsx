import Link from "next/link";

export const RANGE_OPTIONS = [
  { value: "mtd", label: "This month" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "ytd", label: "Year to date" },
  { value: "12m", label: "12 months" },
] as const;

export type RangeKey = (typeof RANGE_OPTIONS)[number]["value"];

export function parseRange(raw: string | undefined, fallback: RangeKey = "mtd"): RangeKey {
  return RANGE_OPTIONS.some((o) => o.value === raw) ? (raw as RangeKey) : fallback;
}

/** Resolve a range key to [start, end) plus a human label. */
export function rangeBounds(key: RangeKey, now = new Date()): { start: Date; end: Date; label: string } {
  const end = new Date(now.getTime() + 1);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (key) {
    case "mtd":
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end, label: now.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
    case "30d":
      return { start: new Date(dayStart.getTime() - 29 * 86_400_000), end, label: "Last 30 days" };
    case "90d":
      return { start: new Date(dayStart.getTime() - 89 * 86_400_000), end, label: "Last 90 days" };
    case "ytd":
      return { start: new Date(now.getFullYear(), 0, 1), end, label: `${now.getFullYear()} to date` };
    case "12m":
      return { start: new Date(now.getFullYear() - 1, now.getMonth(), 1), end, label: "Last 12 months" };
  }
}

/** Server-friendly pill selector that rewrites `?range=` on the current path. */
export function DateRangeSelect({ value, basePath, otherParams = {} }: { value: RangeKey; basePath: string; otherParams?: Record<string, string | undefined> }) {
  const href = (v: RangeKey) => {
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(otherParams)) if (val) p.set(k, val);
    p.set("range", v);
    return `${basePath}?${p.toString()}`;
  };
  return (
    <div className="inline-flex rounded-apple-pill border border-apple-border bg-white p-0.5" role="group" aria-label="Date range">
      {RANGE_OPTIONS.map((o) => (
        <Link
          key={o.value}
          href={href(o.value)}
          scroll={false}
          aria-current={o.value === value ? "page" : undefined}
          className={`rounded-apple-pill px-3 py-1 text-apple-xs font-medium transition-colors ${o.value === value ? "bg-apple-text text-white" : "text-apple-text-secondary hover:text-apple-text"}`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
