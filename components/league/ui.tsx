/**
 * Shared dark-theme primitives for the public /league pages.
 * Colors mirror the member app's tokens (src/theme/tokens.ts) so the web
 * view, kiosk and app feel like one product.
 */
import Link from "next/link";
import type { ReactNode } from "react";

export const L = {
  bg: "#0B0F0C",
  surface: "#151B16",
  surface2: "#1C241D",
  border: "#273029",
  text: "#F3F5F2",
  text2: "#A6B0A8",
  text3: "#6E7A70",
  green: "#22C55E",
  greenSoft: "rgba(34,197,94,0.14)",
  amber: "#F5B544",
  amberSoft: "rgba(245,181,68,0.14)",
  red: "#F0565E",
  blue: "#5EA8FF",
  blueSoft: "rgba(94,168,255,0.14)",
};

export const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function Shell({ children, title, back, subtitle, right }: { children: ReactNode; title: string; subtitle?: ReactNode; back?: { href: string; label: string }; right?: ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: L.bg, color: L.text }}>
      <header className="sticky top-0 z-10 border-b backdrop-blur" style={{ borderColor: L.border, background: "rgba(11,15,12,0.85)" }}>
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          {back ? (
            <Link href={back.href} className="rounded-full px-3 py-1.5 text-sm" style={{ color: L.text2, background: L.surface2 }}>
              ← {back.label}
            </Link>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl tracking-tight" style={{ fontFamily: "var(--font-league-serif), Georgia, serif" }}>{title}</div>
            {subtitle ? <div className="truncate text-xs" style={{ color: L.text2 }}>{subtitle}</div> : null}
          </div>
          {right}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-5">{children}</main>
    </div>
  );
}

export function Card({ children, className = "", tone }: { children: ReactNode; className?: string; tone?: "green" | "amber" | "blue" }) {
  const bg = tone === "green" ? L.greenSoft : tone === "amber" ? L.amberSoft : tone === "blue" ? L.blueSoft : L.surface;
  const bc = tone === "green" ? "rgba(34,197,94,0.35)" : tone === "amber" ? "rgba(245,181,68,0.35)" : tone === "blue" ? "rgba(94,168,255,0.35)" : L.border;
  return (
    <section className={`rounded-2xl border p-4 ${className}`} style={{ background: bg, borderColor: bc }}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-end justify-between first:mt-0">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: L.text3 }}>
        {children}
      </h2>
      {right}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "red" | "blue" }) {
  const map = {
    neutral: { bg: L.surface2, fg: L.text2 },
    green: { bg: L.greenSoft, fg: L.green },
    amber: { bg: L.amberSoft, fg: L.amber },
    red: { bg: "rgba(240,86,94,0.14)", fg: L.red },
    blue: { bg: L.blueSoft, fg: L.blue },
  }[tone];
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: map.bg, color: map.fg }}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl p-3" style={{ background: L.surface2 }}>
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: L.text3 }}>{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-xs" style={{ color: L.text2 }}>{sub}</div> : null}
    </div>
  );
}

export function Row({ children, href, className = "" }: { children: ReactNode; href?: string; className?: string }) {
  const cls = `flex items-center gap-3 py-2.5 ${className}`;
  return href ? (
    <Link href={href} className={`${cls} -mx-2 rounded-xl px-2 hover:bg-white/[0.03]`}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export function Divider() {
  return <div className="h-px w-full" style={{ background: L.border }} />;
}

export function Scorecard({ holes, par }: { holes: number[]; par?: number[] | null }) {
  const nine = (from: number, label: string) => {
    const h = holes.slice(from, from + 9);
    const p = par?.slice(from, from + 9) ?? null;
    return (
      <table className="w-full table-fixed border-collapse text-center text-xs tabular-nums">
        <thead>
          <tr style={{ color: L.text3 }}>
            <th className="w-10 py-1 text-left font-medium">Hole</th>
            {h.map((_, i) => (
              <th key={i} className="py-1 font-medium">{from + i + 1}</th>
            ))}
            <th className="w-10 py-1 font-semibold">{label}</th>
          </tr>
        </thead>
        <tbody>
          {p ? (
            <tr style={{ color: L.text2 }}>
              <td className="py-1 text-left">Par</td>
              {p.map((v, i) => <td key={i} className="py-1">{v}</td>)}
              <td className="py-1 font-semibold">{p.reduce((s, v) => s + v, 0)}</td>
            </tr>
          ) : null}
          <tr>
            <td className="py-1 text-left" style={{ color: L.text2 }}>Score</td>
            {h.map((v, i) => {
              const pv = p?.[i];
              const d = pv == null ? 0 : v - pv;
              const color = d <= -2 ? L.amber : d === -1 ? L.green : d === 0 ? L.text : d === 1 ? L.text2 : L.red;
              return (
                <td key={i} className="py-1 font-semibold" style={{ color }}>{v}</td>
              );
            })}
            <td className="py-1 font-bold">{h.reduce((s, v) => s + v, 0)}</td>
          </tr>
        </tbody>
      </table>
    );
  };
  return (
    <div className="space-y-2 overflow-hidden rounded-xl p-2" style={{ background: L.surface2 }}>
      {nine(0, "OUT")}
      <Divider />
      {nine(9, "IN")}
    </div>
  );
}

export function RankBadge({ rank }: { rank: number }) {
  const tone = rank === 1 ? L.amber : rank <= 5 ? L.green : L.text2;
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums" style={{ background: L.surface2, color: tone }}>
      {rank}
    </div>
  );
}
