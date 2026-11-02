"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Textarea, formatMoney, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";

export type LeagueListRow = {
  id: string;
  name: string;
  status: string;
  location: string;
  playerCount: number;
  weeks: number;
  championshipPotCents: number;
  currentWeek: { weekNumber: number; courseName: string | null; deadlineAt: string; potCents: number } | null;
};

type Loc = { id: string; name: string; slug: string; timezone: string };

function nextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

export function LeagueListClient({ leagues, locations }: { leagues: LeagueListRow[]; locations: Loc[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    locationId: locations[0]?.id ?? "",
    name: "Winter League",
    description: "",
    firstWeekStart: nextMonday(),
    weekCount: "12",
    withChampionshipWeek: false,
    championshipAt: "2027-03-06",
    weeklyFee: "10",
    courses: "",
  });

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/league", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          locationId: form.locationId,
          name: form.name,
          description: form.description || null,
          firstWeekStart: new Date(`${form.firstWeekStart}T12:00:00`).toISOString(),
          weekCount: Number(form.weekCount),
          withChampionshipWeek: form.withChampionshipWeek,
          championshipAt: form.championshipAt ? new Date(`${form.championshipAt}T12:00:00`).toISOString() : null,
          weeklyFeeCents: Math.round(Number(form.weeklyFee) * 100),
          courses: form.courses.split("\n").map((s) => s.trim()),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Could not create league");
      toast({ tone: "success", title: "League created" });
      setOpen(false);
      router.push(adminRoutes.leagueDetail(j.league.id));
    } catch (e) {
      toast({ tone: "error", title: e instanceof Error ? e.message : "Could not create league" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)} disabled={!locations.length}>New league</Button>
      </div>
      {leagues.length === 0 ? (
        <EmptyState title="No leagues yet" description="Create a league to open weekly score submissions on the bay kiosks. Members join and follow along in the app." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {leagues.map((l) => (
            <Link key={l.id} href={adminRoutes.leagueDetail(l.id)}>
              <Card className="h-full transition hover:shadow-apple-lg">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-apple-lg font-semibold text-apple-text">{l.name}</div>
                    <div className="text-apple-sm text-apple-text-secondary">{l.location} · {l.playerCount} players · {l.weeks} weeks</div>
                  </div>
                  <Badge tone={l.status === "ACTIVE" || l.status === "OPEN" ? "success" : l.status === "COMPLETE" ? "muted" : "warn"}>{l.status}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-apple-sm">
                  <div>
                    <div className="text-apple-xs text-apple-text-tertiary">Current week</div>
                    <div className="font-medium">{l.currentWeek ? `Wk ${l.currentWeek.weekNumber}${l.currentWeek.courseName ? ` · ${l.currentWeek.courseName}` : ""}` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-apple-xs text-apple-text-tertiary">Week pot</div>
                    <div className="font-medium">{l.currentWeek ? formatMoney(l.currentWeek.potCents) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-apple-xs text-apple-text-tertiary">Championship pot</div>
                    <div className="font-medium">{formatMoney(l.championshipPotCents)}</div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New league"
        description="Weeks run Monday 12:00 AM → Sunday 11:59 PM in the location's time zone. Weeks 1–2 are played straight; handicaps apply from week 3. Scores are submitted at the bay kiosk only."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} loading={busy} disabled={!form.name || !form.locationId}>Create</Button>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Location" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="First week starts (Monday)" type="date" value={form.firstWeekStart} onChange={(e) => setForm({ ...form, firstWeekStart: e.target.value })} />
          <Input label="Number of weeks" type="number" min={1} max={30} value={form.weekCount} onChange={(e) => setForm({ ...form, weekCount: e.target.value })} />
          <Input label="Weekly entry ($)" type="number" min={0} step="1" value={form.weeklyFee} onChange={(e) => setForm({ ...form, weeklyFee: e.target.value })} />
          <Input label="Championship date" type="date" value={form.championshipAt} onChange={(e) => setForm({ ...form, championshipAt: e.target.value })} hint="Top 50% by points qualify" />
          <label className="flex items-center gap-2 text-apple-sm text-apple-text sm:col-span-2">
            <input type="checkbox" checked={form.withChampionshipWeek} onChange={(e) => setForm({ ...form, withChampionshipWeek: e.target.checked })} />
            Add a championship week after the last regular week
          </label>
          <div className="sm:col-span-2">
            <Textarea label="Courses (one per line, in week order)" rows={4} value={form.courses} onChange={(e) => setForm({ ...form, courses: e.target.value })} hint="Leave blank to set later per week." />
          </div>
          <div className="sm:col-span-2">
            <Textarea label="Description (optional)" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
      </Modal>
    </>
  );
}
