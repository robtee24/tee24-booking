"use client";

import React from "react";
import { Check, ChevronDown, ChevronUp, RefreshCw, Sparkles } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { api, errMsg, Stat, SwingHeader } from "../shared";

type Opt = { key: string; label: string };
type Survey = { options: { goals: Opt[]; issues: Opt[]; weakClubs: Opt[]; misses: Opt[] }; focusAreas: { key: string; label: string; blurb: string }[]; experience: { key: string; label: string; blurb: string }[] };
type Profile = { handicap: number | null; experience: string | null; sessionsPerWeek: number | null; minutesPerSession: number | null; handedness: string | null; goals: string[]; issues: string[]; weakClubs: string[]; misses: string[] } | null;
type Drill = { key: string; title: string; area: string; level: string; minutes: number; clubs: string; equipment: string; setup: string; steps: string[]; successMetric: string; cue: string };
type Plan = {
  id: string; version: number; title: string; summary: string; createdAt: string;
  focusAreas: { key: string; label: string; blurb: string; weight: number; reasons: string[] }[];
  schedule: { day: number; title: string; focus: string[]; minutes: number; drills: { key: string; minutes: number; area: string; note?: string }[] }[];
  drills: Drill[];
  basis: { sessionsAnalyzed: number; shotsAnalyzed: number; flags: { title: string }[]; reason?: string };
};
type PlanResp = { plan: Plan | null; hasProfile: boolean; adherence: { weekDrillsPlanned: number; weekDrillsDone: number; weekMinutes: number; doneKeys: string[] } | null };

const DAYS = ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"];

export function PlanClient({ readOnly }: { readOnly: boolean }) {
  const { toast } = useToast();
  const [data, setData] = React.useState<PlanResp | null>(null);
  const [survey, setSurvey] = React.useState<(Survey & { profile: Profile }) | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [surveyOpen, setSurveyOpen] = React.useState(false);
  const [logDrill, setLogDrill] = React.useState<Drill | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [openDrill, setOpenDrill] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    Promise.all([api<PlanResp>("/api/portal/practice/plan").then(setData), api<Survey & { profile: Profile }>("/api/portal/practice/profile").then(setSurvey)]).catch((e) => setError(errMsg(e)));
  }, []);
  React.useEffect(load, [load]);

  async function regenerate() {
    setBusy(true);
    try {
      await api("/api/portal/practice/plan/regenerate", { method: "POST" });
      toast({ tone: "success", title: "Plan refreshed from your latest sessions" });
      load();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't refresh", description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  const plan = data?.plan ?? null;
  const drillByKey = new Map((plan?.drills ?? []).map((d) => [d.key, d]));
  const done = new Set(data?.adherence?.doneKeys ?? []);

  return (
    <div className="space-y-6">
      <SwingHeader subtitle="A weekly plan built from your goals and what your shot data shows. It re-tunes every time you import a session." />
      {error && <div className="rounded-apple-sm bg-apple-red/10 px-4 py-3 text-apple-sm text-apple-red">{error}</div>}
      {!data && !error && <p className="text-apple-sm text-apple-text-tertiary">Loading…</p>}

      {data && !data.hasProfile && (
        <Card>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-apple-lg font-semibold text-apple-text"><Sparkles className="h-5 w-5 text-apple-blue" /> Tell us about your game</h2>
              <p className="mt-1 text-apple-sm text-apple-text-secondary">A two-minute survey — goals, misses, the clubs that give you trouble — and we&apos;ll build your first plan.</p>
            </div>
            <Button onClick={() => setSurveyOpen(true)} disabled={readOnly || !survey}>Start survey</Button>
          </div>
        </Card>
      )}

      {plan && (
        <>
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">Plan v{plan.version} · built {new Date(plan.createdAt).toLocaleDateString()}</div>
                <h2 className="text-apple-xl font-semibold text-apple-text">{plan.title}</h2>
                <p className="mt-1 text-apple-sm text-apple-text-secondary">{plan.summary}</p>
              </div>
              {!readOnly && (
                <div className="flex shrink-0 gap-2 whitespace-nowrap">
                  <Button variant="secondary" size="sm" onClick={() => setSurveyOpen(true)}>Edit survey</Button>
                  <Button variant="secondary" size="sm" iconLeft={<RefreshCw className="h-3.5 w-3.5" />} loading={busy} onClick={() => void regenerate()}>Refresh</Button>
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="This week" value={`${data?.adherence?.weekDrillsDone ?? 0} / ${data?.adherence?.weekDrillsPlanned ?? 0}`} hint="drills done" />
              <Stat label="Minutes" value={data?.adherence?.weekMinutes ?? 0} hint="this week" />
              <Stat label="Based on" value={plan.basis.sessionsAnalyzed} hint={`sessions · ${plan.basis.shotsAnalyzed} shots`} />
              <Stat label="Focus areas" value={plan.focusAreas.length} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Focus areas" subtitle="Weighted by your survey and what your data shows" />
            <ul className="mt-3 space-y-3">
              {plan.focusAreas.map((f) => (
                <li key={f.key}>
                  <div className="flex items-center justify-between text-apple-sm">
                    <span className="font-medium text-apple-text">{f.label}</span>
                    <span className="text-apple-text-tertiary">{Math.round(f.weight * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-apple-fill-secondary"><div className="h-full rounded-full bg-apple-blue" style={{ width: `${Math.min(100, Math.round(f.weight * 100))}%` }} /></div>
                  <p className="mt-1 text-apple-xs text-apple-text-secondary">{f.blurb}{f.reasons.length ? ` — ${f.reasons.slice(0, 2).join("; ")}` : ""}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="This week" subtitle="Tap a drill for the full setup. Log it when you've done it." />
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {plan.schedule.map((s) => (
                <div key={s.day} className="rounded-apple-sm border border-apple-border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">{DAYS[s.day - 1] ?? `Day ${s.day}`}</div>
                      <div className="text-apple-sm font-semibold text-apple-text">{s.title}</div>
                    </div>
                    <Badge tone="muted" size="sm">{s.minutes} min</Badge>
                  </div>
                  <ul className="mt-2 divide-y divide-apple-divider">
                    {s.drills.map((d) => {
                      const drill = drillByKey.get(d.key);
                      const isOpen = openDrill === `${s.day}-${d.key}`;
                      const isDone = done.has(d.key);
                      return (
                        <li key={d.key} className="py-2">
                          <div className="flex items-start justify-between gap-2">
                            <button type="button" onClick={() => setOpenDrill(isOpen ? null : `${s.day}-${d.key}`)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${isDone ? "border-apple-green bg-apple-green text-white" : "border-apple-border"}`}>{isDone && <Check className="h-3 w-3" />}</span>
                              <span className="min-w-0">
                                <span className="block text-apple-sm font-medium text-apple-text">{drill?.title ?? d.key}</span>
                                <span className="block text-apple-xs text-apple-text-tertiary">{d.minutes} min{drill ? ` · ${drill.clubs}` : ""}{d.note ? ` · ${d.note}` : ""}</span>
                              </span>
                              {isOpen ? <ChevronUp className="ml-auto h-4 w-4 text-apple-text-tertiary" /> : <ChevronDown className="ml-auto h-4 w-4 text-apple-text-tertiary" />}
                            </button>
                            {!readOnly && drill && <Button size="sm" variant={isDone ? "secondary" : "primary"} onClick={() => setLogDrill(drill)}>{isDone ? "Log again" : "Log"}</Button>}
                          </div>
                          {isOpen && drill && (
                            <div className="mt-2 space-y-2 rounded-apple-sm bg-apple-fill-secondary/50 p-3 text-apple-sm">
                              <p><span className="font-medium text-apple-text">Cue:</span> <span className="text-apple-text-secondary">{drill.cue}</span></p>
                              <p><span className="font-medium text-apple-text">Setup:</span> <span className="text-apple-text-secondary">{drill.setup}</span>{drill.equipment ? <span className="text-apple-text-tertiary"> · {drill.equipment}</span> : null}</p>
                              <ol className="list-decimal space-y-1 pl-5 text-apple-text-secondary">{drill.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
                              <p className="text-apple-xs text-apple-text-tertiary"><span className="font-medium">It&apos;s working when:</span> {drill.successMetric}</p>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {survey && <SurveyModal open={surveyOpen} onClose={() => setSurveyOpen(false)} survey={survey} onSaved={() => { setSurveyOpen(false); load(); }} />}
      {logDrill && <LogDrillModal drill={logDrill} planId={plan?.id ?? null} onClose={() => setLogDrill(null)} onSaved={() => { setLogDrill(null); load(); }} />}
    </div>
  );
}

/* ───────────────────────────── Survey ─────────────────────────────────── */

function SurveyModal({ open, onClose, survey, onSaved }: { open: boolean; onClose: () => void; survey: Survey & { profile: Profile }; onSaved: () => void }) {
  const p = survey.profile;
  const [goals, setGoals] = React.useState<string[]>(p?.goals ?? []);
  const [issues, setIssues] = React.useState<string[]>(p?.issues ?? []);
  const [weakClubs, setWeakClubs] = React.useState<string[]>(p?.weakClubs ?? []);
  const [misses, setMisses] = React.useState<string[]>(p?.misses ?? []);
  const [experience, setExperience] = React.useState(p?.experience ?? "INTERMEDIATE");
  const [handedness, setHandedness] = React.useState(p?.handedness ?? "RH");
  const [handicap, setHandicap] = React.useState(p?.handicap != null ? String(p.handicap) : "");
  const [sessionsPerWeek, setSpw] = React.useState(p?.sessionsPerWeek != null ? String(p.sessionsPerWeek) : "2");
  const [minutes, setMinutes] = React.useState(p?.minutesPerSession != null ? String(p.minutesPerSession) : "45");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const toggle = (arr: string[], set: (v: string[]) => void, k: string) => set(arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/portal/practice/profile", { method: "PUT", json: { goals, issues, weakClubs, misses, experience, handedness, handicap: handicap === "" ? null : Number(handicap), sessionsPerWeek: Number(sessionsPerWeek), minutesPerSession: Number(minutes) } });
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="About your game" wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} loading={busy} disabled={!goals.length}>Build my plan</Button></>}>
      <div className="space-y-5">
        <Chips title="What are you working toward?" hint="Pick at least one" options={survey.options.goals} value={goals} onToggle={(k) => toggle(goals, setGoals, k)} />
        <Chips title="What's holding you back?" options={survey.options.issues} value={issues} onToggle={(k) => toggle(issues, setIssues, k)} />
        <Chips title="Clubs that give you trouble" options={survey.options.weakClubs} value={weakClubs} onToggle={(k) => toggle(weakClubs, setWeakClubs, k)} />
        <Chips title="Your typical miss" options={survey.options.misses} value={misses} onToggle={(k) => toggle(misses, setMisses, k)} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Select label="Experience" value={experience} onChange={(e) => setExperience(e.target.value)}>
            {survey.experience.map((x) => <option key={x.key} value={x.key}>{x.label} — {x.blurb}</option>)}
          </Select>
          <Select label="Handedness" value={handedness} onChange={(e) => setHandedness(e.target.value)}>
            <option value="RH">Right-handed</option>
            <option value="LH">Left-handed</option>
          </Select>
          <Input label="Handicap (optional)" type="number" step="0.1" value={handicap} onChange={(e) => setHandicap(e.target.value)} placeholder="18" />
          <Input label="Sessions per week" type="number" min={1} max={7} value={sessionsPerWeek} onChange={(e) => setSpw(e.target.value)} />
          <Input label="Minutes per session" type="number" min={15} max={180} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        {error && <p className="text-apple-sm text-apple-red">{error}</p>}
      </div>
    </Modal>
  );
}

function Chips({ title, hint, options, value, onToggle }: { title: string; hint?: string; options: Opt[]; value: string[]; onToggle: (k: string) => void }) {
  return (
    <section>
      <h3 className="text-apple-sm font-semibold text-apple-text">{title}{hint && <span className="ml-2 text-apple-xs font-normal text-apple-text-tertiary">{hint}</span>}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.key);
          return (
            <button key={o.key} type="button" onClick={() => onToggle(o.key)} aria-pressed={on} className={`rounded-apple-pill px-3 py-1.5 text-apple-sm transition-colors ${on ? "bg-apple-blue text-white" : "bg-apple-fill-secondary text-apple-text-secondary hover:text-apple-text"}`}>
              {o.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ───────────────────────────── Log a drill ────────────────────────────── */

function LogDrillModal({ drill, planId, onClose, onSaved }: { drill: Drill; planId: string | null; onClose: () => void; onSaved: () => void }) {
  const [minutes, setMinutes] = React.useState(String(drill.minutes));
  const [rating, setRating] = React.useState(3);
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/portal/practice/drills/log", { method: "POST", json: { drillKey: drill.key, planId, minutes: Number(minutes) || undefined, rating, notes: notes.trim() || undefined } });
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Log: ${drill.title}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} loading={busy}>Save</Button></>}>
      <div className="space-y-3">
        <Input label="Minutes" type="number" min={1} max={300} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <div>
          <div className="mb-1 text-apple-sm font-medium text-apple-text">How did it feel?</div>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)} aria-pressed={rating === n} className={`h-9 w-9 rounded-apple-sm border text-apple-sm font-medium ${rating === n ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border text-apple-text-secondary hover:bg-apple-fill-secondary"}`}>{n}</button>
            ))}
          </div>
        </div>
        <Textarea label="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p className="text-apple-sm text-apple-red">{error}</p>}
      </div>
    </Modal>
  );
}
