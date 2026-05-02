/**
 * Format cents as a currency string. Handles null/undefined gracefully.
 */
export function formatMoney(cents: number | null | undefined, currency: string = "USD"): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n / 100);
}

export function Money({ cents, currency = "USD", className = "" }: { cents: number | null | undefined; currency?: string; className?: string }) {
  return <span className={["tabular-nums", className].join(" ")}>{formatMoney(cents, currency)}</span>;
}
