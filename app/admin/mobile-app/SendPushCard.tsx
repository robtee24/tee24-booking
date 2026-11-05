"use client";

import React from "react";
import { BellRing, Search, Send, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input, Modal, Select, Textarea, useToast } from "@/components/ui";

export type PushLocation = { id: string; name: string; reachable: number };
type MemberHit = { id: string; firstName: string; lastName: string; phone: string; platform: string; pushEnabled: boolean; locationName: string };

const MAX_TITLE = 60;
const MAX_BODY = 500;

const fmtPhone = (p: string) => {
  const d = p.replace(/\D/g, "").replace(/^1/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
};

export function SendPushCard({ locations }: { locations: PushLocation[] }) {
  const { toast } = useToast();
  const [locationId, setLocationId] = React.useState(locations[0]?.id ?? "");
  const [audience, setAudience] = React.useState<"location" | "member">("location");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [liveReachable, setLiveReachable] = React.useState<Record<string, number>>({});
  const [confirm, setConfirm] = React.useState(false);
  const [sending, setSending] = React.useState(false);

  // Single-member target (search bound devices at the chosen location)
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<MemberHit[]>([]);
  const [member, setMember] = React.useState<MemberHit | null>(null);

  const location = locations.find((l) => l.id === locationId) ?? null;
  const reachable: number | null = location ? liveReachable[location.id] ?? location.reachable : null;

  function chooseLocation(id: string) {
    setLocationId(id);
    setMember(null);
    setQ("");
    setHits([]);
    fetch(`/api/admin/mobile/push?locationId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setLiveReachable((cur) => ({ ...cur, [id]: j.reachable as number }));
      })
      .catch(() => undefined);
  }

  function chooseAudience(a: "location" | "member") {
    setAudience(a);
    setMember(null);
    setQ("");
    setHits([]);
  }

  // Debounced member search among bound devices at the chosen location.
  React.useEffect(() => {
    const term = q.trim();
    if (audience !== "member" || term.length < 2) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/mobile/devices?q=${encodeURIComponent(term)}`);
        const json = await res.json();
        if (!json.ok) return;
        const seen = new Set<string>();
        const list: MemberHit[] = [];
        for (const d of json.devices as Array<{ platform: string; pushEnabled: boolean; member: { id: string; firstName: string; lastName: string; phone: string; locationId: string; location: { name: string } } }>) {
          if (d.member.locationId !== locationId || seen.has(d.member.id)) continue;
          seen.add(d.member.id);
          list.push({ id: d.member.id, firstName: d.member.firstName, lastName: d.member.lastName, phone: d.member.phone, platform: d.platform, pushEnabled: d.pushEnabled, locationName: d.member.location.name });
        }
        setHits(list.slice(0, 8));
      } catch {
        /* ignore */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, audience, locationId]);

  const canSend = !!locationId && body.trim().length > 0 && body.length <= MAX_BODY && title.length <= MAX_TITLE && (audience === "location" ? (reachable ?? 0) > 0 : !!member) && (!url || url.startsWith("/(tabs)"));

  async function send() {
    setSending(true);
    try {
      const res = await fetch("/api/admin/mobile/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, title: title.trim() || undefined, body: body.trim(), url: url.trim() || undefined, memberId: audience === "member" ? member?.id : undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json?.error || (json?.errors?.[0] ?? `HTTP ${res.status}`));
      toast({
        tone: "success",
        title: json.sent === 1 && audience === "member" ? `Sent to ${member?.firstName}` : `Sent to ${json.sent} member${json.sent === 1 ? "" : "s"} at ${json.location}`,
        description: json.failed ? `${json.failed} couldn't be delivered${json.errors?.[0] ? `: ${json.errors[0]}` : ""}` : undefined,
      });
      setConfirm(false);
      setTitle("");
      setBody("");
      setUrl("");
    } catch (e) {
      toast({ tone: "error", title: "Push not sent", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSending(false);
    }
  }

  const targetLabel = audience === "member" ? (member ? `${member.firstName} ${member.lastName}` : "one member") : `${reachable ?? "…"} member${reachable === 1 ? "" : "s"} at ${location?.name ?? "this location"}`;

  return (
    <Card>
      <CardHeader title="Send a push notification" subtitle="Goes to members who have the app installed with notifications on. Each send is logged on the member's timeline." />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Select label="Location" value={locationId} onChange={(e) => chooseLocation(e.target.value)}>
            {locations.length === 0 && <option value="">No locations</option>}
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <div>
            <div className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Send to</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={audience === "location" ? "primary" : "secondary"} onClick={() => chooseAudience("location")}>
                Everyone at {location?.name ?? "location"}
                {reachable != null && (
                  <Badge tone={reachable > 0 ? "success" : "muted"} size="sm" className="ml-2">
                    {reachable}
                  </Badge>
                )}
              </Button>
              <Button size="sm" variant={audience === "member" ? "primary" : "secondary"} onClick={() => chooseAudience("member")}>
                One member (test)
              </Button>
            </div>
            {audience === "location" && reachable === 0 && <p className="mt-2 text-apple-xs text-apple-text-secondary">Nobody at this location has the app with notifications on yet.</p>}
          </div>
          {audience === "member" && (
            <div>
              {member ? (
                <div className="flex items-center justify-between rounded-apple border border-apple-border px-3 py-2 text-apple-sm">
                  <div>
                    <span className="font-medium text-apple-text">
                      {member.firstName} {member.lastName}
                    </span>
                    <span className="ml-2 text-apple-text-secondary">
                      {fmtPhone(member.phone)} · {member.platform === "android" ? "Android" : "iOS"}
                    </span>
                    {!member.pushEnabled && (
                      <Badge tone="warn" size="sm" className="ml-2">
                        Push off
                      </Badge>
                    )}
                  </div>
                  <button type="button" className="text-apple-text-secondary hover:text-apple-text" onClick={() => setMember(null)} aria-label="Clear member">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <Input label="Member" placeholder="Search name or phone" value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) setHits([]); }} prefix={<Search size={14} />} />
                  {hits.length > 0 && (
                    <div className="mt-1 divide-y divide-apple-divider rounded-apple border border-apple-border">
                      {hits.map((h) => (
                        <button key={h.id} type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-apple-sm hover:bg-apple-fill-secondary" onClick={() => setMember(h)}>
                          <span>
                            <span className="font-medium text-apple-text">
                              {h.firstName} {h.lastName}
                            </span>
                            <span className="ml-2 text-apple-text-secondary">{fmtPhone(h.phone)}</span>
                          </span>
                          <span className="flex items-center gap-2 text-apple-xs text-apple-text-secondary">
                            {h.platform === "android" ? "Android" : "iOS"}
                            {h.pushEnabled ? <Badge tone="success" size="sm">Push on</Badge> : <Badge tone="muted" size="sm">Push off</Badge>}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {q.trim().length >= 2 && hits.length === 0 && <p className="mt-1 text-apple-xs text-apple-text-secondary">No app devices match at {location?.name ?? "this location"}.</p>}
                </>
              )}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <Input label="Title (optional)" placeholder="Tee24" value={title} onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))} hint={`${title.length}/${MAX_TITLE}`} />
          <Textarea label="Message" placeholder="e.g. Bay 3 is back online — book your next session in the app." value={body} onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))} rows={4} hint={`${body.length}/${MAX_BODY}`} />
          <Select label="Open in app (optional)" value={url} onChange={(e) => setUrl(e.target.value)}>
            <option value="">Home</option>
            <option value="/(tabs)/book">Book a bay</option>
            <option value="/(tabs)/unlock">Unlock door</option>
            <option value="/(tabs)/league">League</option>
            <option value="/(tabs)/improve/plan">Practice plan</option>
            <option value="/(tabs)/improve/swing">Swing analysis</option>
            <option value="/(tabs)/settings/membership">Membership & billing</option>
          </Select>
          <div className="flex justify-end">
            <Button iconLeft={<Send size={14} />} disabled={!canSend} onClick={() => setConfirm(true)}>
              Send push
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={confirm}
        onClose={() => !sending && setConfirm(false)}
        title="Send push notification?"
        description={`This will go to ${targetLabel} right now.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)} disabled={sending}>
              Cancel
            </Button>
            <Button iconLeft={<BellRing size={14} />} loading={sending} onClick={send}>
              Send now
            </Button>
          </>
        }
      >
        <div className="rounded-apple border border-apple-border bg-apple-fill-secondary p-3 text-apple-sm">
          <div className="font-semibold text-apple-text">{title.trim() || "Tee24"}</div>
          <div className="mt-0.5 whitespace-pre-wrap text-apple-text">{body.trim()}</div>
        </div>
      </Modal>
    </Card>
  );
}
