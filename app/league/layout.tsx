import type { ReactNode } from "react";
import { DM_Serif_Display, Inter } from "next/font/google";

/**
 * Public /league pages share the member app's type: Inter for UI, DM Serif
 * Display for headlines (exposed as the `--font-league-serif` variable).
 */
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-league-sans" });
const serif = DM_Serif_Display({ subsets: ["latin"], weight: "400", display: "swap", variable: "--font-league-serif" });

export default function LeagueLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${inter.variable} ${serif.variable}`} style={{ fontFamily: "var(--font-league-sans), ui-sans-serif, system-ui, sans-serif" }}>
      {children}
    </div>
  );
}
