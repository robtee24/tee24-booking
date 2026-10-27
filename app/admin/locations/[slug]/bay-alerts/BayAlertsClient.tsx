"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ClipboardCheck, LogOut, RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Textarea, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import type { listGuestViolations } from "@/services/bay-players.service";

type Item = Awaited<ReturnType<typeof listGuestViolations>>[number];

const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function fmt(iso: string, tz: string, opts: Intl.DateTimeFormatOptions) {
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: tz, ...opts });
  } catch {
    return new Date(iso).toLocaleString("en-US", opts);
  }
}

export function BayAlertsClient({ slug, timezone, initialItems, focusId }: { slug: string; timezone: string; initialItems: Item[]; focusId: string | null }) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [open, setOpen] = useState<string | null>(focusId);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const focusRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (focusId && focusRef.current) focusRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusId]);

  async function refresh() {
    setBusy("refresh");
    try {
      const r = await fetch(`/api/admin/bay-alerts?locationSlug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed to load");
      setItems(j.items as Item[]);
    } catch (e) {
      toast({ tone: "error", title: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function review(id: string) {
    setBusy("review" + id);
    try {
      const r = await fetch("/api/admin/bay-alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "review", notes: notes[id] ?? "" }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed");
      toast({ tone: "success", title: "Marked reviewed" });
      await refresh();
    } catch (e) {
      toast({ tone: "error", title: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const pending = useMemo(() => items.filter((i) => !i.reviewedAt).length, [items]);

  return (
    <Card>
      <CardHeader
        title={`${items.length} alert${items.length === 1 ? "" : "s"}`}
        subtitle={pending ? `${pending} awaiting review.` : "Everything has been reviewed."}
        action={
          <Button variant="secondary" size="sm" iconLeft={<RefreshCw className="h-4 w-4" />} onClick={() => void refresh()} loading={busy === "refresh"}>
            Refresh
          </Button>
        }
      />
      {items.length === 0 ? (
        <EmptyState icon={<AlertTriangle className="h-6 w-6" />} title="No alerts" description="When a bay kiosk sees more players in GSPro than a booking allows, the player's choice (continue and pay, or exit the game) shows up here with a timestamp." />
      ) : (
        <ul className="mt-4 divide-y divide-apple-border">
          {items.map((it) => {
            const isOpen = open === it.id;
            const focused = focusId === it.id;
            return (
              <li key={it.id} ref={focused ? focusRef : undefined} className={`py-4 ${focused ? "-mx-3 rounded-apple bg-apple-orange/5 px-3" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-apple-sm font-semibold text-apple-text">
                        Bay {it.bayNumber} · {it.playerCount} players, {it.allowedPlayers} allowed
                      </span>
                      {it.action === "EXITED" ? (
                        <Badge tone="info" size="sm">
                          <LogOut className="h-3 w-3" /> Exited the game · no charge
                        </Badge>
                      ) : (
                        <Badge tone="warn" size="sm">
                          Continued · {it.extraGuests} unauthorized · {usd(it.feeCents)}
                        </Badge>
                      )}
                      <Badge tone={it.screen === "ROUND" ? "danger" : "muted"} size="sm">
                        {it.screen === "ROUND" ? "Caught mid-round" : "Caught at match setup"}
                      </Badge>
                      {it.reviewedAt ? (
                        <Badge tone="success" size="sm">
                          <Check className="h-3 w-3" /> Reviewed
                        </Badge>
                      ) : (
                        <Badge tone="muted" size="sm">Needs review</Badge>
                      )}
                    </div>
                    <div className="mt-1 text-apple-xs text-apple-text-secondary">
                      {it.action === "EXITED" ? "Exited" : "Acknowledged"} {fmt(it.acknowledgedAt, timezone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}
                      {it.booking ? (
                        <>
                          {" · "}
                          {it.member ? (
                            <Link href={adminRoutes.loc.members.detail(slug, it.member.id)} className="font-medium text-apple-blue hover:underline">
                              {it.booking.name}
                            </Link>
                          ) : (
                            <span className="font-medium text-apple-text">{it.booking.name}</span>
                          )}
                          {" · "}reservation {fmt(it.booking.start, timezone, { hour: "numeric", minute: "2-digit" })}–{fmt(it.booking.end, timezone, { hour: "numeric", minute: "2-digit" })}
                          {" · "}{it.booking.phone}
                        </>
                      ) : (
                        " · no reservation matched"
                      )}
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" iconLeft={<ClipboardCheck className="h-4 w-4" />} onClick={() => setOpen(isOpen ? null : it.id)}>
                    {isOpen ? "Hide" : it.reviewedAt ? "Review" : "Review…"}
                  </Button>
                </div>

                {isOpen && (
                  <div className="mt-4 max-w-xl space-y-2">
                    <Textarea
                      label="Review notes"
                      rows={4}
                      value={notes[it.id] ?? it.reviewNotes ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [it.id]: e.target.value }))}
                      placeholder={it.action === "EXITED" ? "e.g. Spoke with the member; group left after the warning." : "e.g. Charged $100 to card on file."}
                    />
                    <Button size="sm" onClick={() => void review(it.id)} loading={busy === "review" + it.id} iconLeft={<Check className="h-4 w-4" />}>
                      {it.reviewedAt ? "Update review" : "Mark reviewed"}
                    </Button>
                    {it.action !== "EXITED" && (
                      <p className="text-apple-xs text-apple-text-tertiary">
                        Charging the {usd(it.feeCents)} is a manual step for now: open the member and add a one-off charge from Billing.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
