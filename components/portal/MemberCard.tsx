"use client";

import React from "react";
import { Printer, Wallet } from "lucide-react";
import { Button, Card, StatusBadge } from "@/components/ui";

export type CardDTO = {
  memberId: string;
  name: string;
  photoUrl: string | null;
  status: string;
  checkinCode: string | null;
  memberSince: string;
  location: { name: string; slug: string; logoUrl: string | null; businessName: string | null } | null;
  plan: string | null;
  planStatus: string | null;
  validThrough: string | null;
  qrPayload: string;
};

export function MemberCard({ card, qrSvg }: { card: CardDTO; qrSvg: string }) {
  const initials = card.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const active = card.status === "ACTIVE" && (card.planStatus === "ACTIVE" || card.planStatus === "COMP" || card.planStatus === "CANCEL_SCHEDULED");

  return (
    <div className="space-y-4">
      <div className="mx-auto w-full max-w-md print:max-w-none">
        <div className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-[#0b3d2e] via-[#0f5a3f] to-[#1b7a4f] p-6 text-white shadow-apple-lg print:shadow-none print:ring-1 print:ring-black/20">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 h-52 w-52 rounded-full bg-black/10" />
          <div className="relative flex items-start justify-between">
            <div className="flex items-center gap-3">
              {card.location?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.location.logoUrl} alt="" className="h-9 w-9 rounded-apple-sm bg-white/90 object-contain p-1" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-apple-sm bg-white text-[11px] font-bold text-[#0f5a3f]">T24</span>
              )}
              <div>
                <div className="text-apple-sm font-semibold leading-tight">{card.location?.businessName ?? card.location?.name ?? "Tee24"}</div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/70">Member</div>
              </div>
            </div>
            <span className={`rounded-apple-pill px-2.5 py-1 text-[11px] font-semibold ${active ? "bg-white/20 text-white" : "bg-black/30 text-white/80"}`}>{active ? "ACTIVE" : card.planStatus ?? card.status}</span>
          </div>

          <div className="relative mt-6 flex items-center gap-4">
            {card.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.photoUrl} alt="" className="h-16 w-16 rounded-full border-2 border-white/60 object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/60 bg-white/15 text-apple-xl font-semibold">{initials}</div>
            )}
            <div className="min-w-0">
              <div className="truncate text-apple-xl font-semibold tracking-tight">{card.name}</div>
              <div className="truncate text-apple-sm text-white/80">{card.plan ?? "No active plan"}</div>
              <div className="text-apple-xs text-white/60">Member since {new Date(card.memberSince).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</div>
            </div>
          </div>

          <div className="relative mt-6 flex items-end justify-between gap-4">
            <div className="space-y-2">
              {card.validThrough && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/60">Valid through</div>
                  <div className="text-apple-sm font-medium">{new Date(card.validThrough).toLocaleDateString()}</div>
                </div>
              )}
              <div className="font-mono text-[10px] text-white/50">{card.memberId}</div>
            </div>
            <div className="shrink-0 rounded-apple bg-white p-2 shadow-apple" dangerouslySetInnerHTML={{ __html: qrSvg }} aria-label="Member QR code" />
          </div>
        </div>
      </div>

      <Card className="mx-auto max-w-md print:hidden">
        <p className="text-apple-sm text-apple-text-secondary">
          Your digital member card. Door access works through the Kisi app on your phone — this card is for identification and staff lookups.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" iconLeft={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
            Print card
          </Button>
          <Button variant="ghost" iconLeft={<Wallet className="h-4 w-4" />} onClick={() => void saveQr(qrSvg, card.name)}>
            Save QR image
          </Button>
          <StatusBadge status={card.status} size="sm" />
        </div>
      </Card>

      <style jsx global>{`
        @media print {
          body { background: #fff !important; }
          header, nav, footer { display: none !important; }
          main { max-width: none !important; padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}

async function saveQr(svg: string, name: string) {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tee24-member-card-${name.replace(/\s+/g, "-").toLowerCase()}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
