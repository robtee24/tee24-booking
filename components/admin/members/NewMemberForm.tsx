"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Send, UserPlus } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { Button, Card, CardHeader, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { ACQUISITION_SOURCES, Checkbox, GENDERS, TagChip, api, errMsg, todayInput } from "./shared";
import { CustomFieldInput, ListEditor, type CustomField } from "./EditMemberDrawer";

type Plan = { id: string; name: string; priceCents: number; signupFeeCents: number; billingCadence: string; durationDays: number | null };
type Tag = { id: string; name: string; color: string | null };

export function NewMemberForm({ slug, plans, tags, requiredDocs, customFields }: { slug: string; plans: Plan[]; tags: Tag[]; requiredDocs: { id: string; name: string }[]; customFields: CustomField[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);

  const [f, setF] = React.useState({
    type: "member" as "member" | "visitor",
    firstName: "", lastName: "", email: "", phone: "",
    secondaryEmails: [] as string[], secondaryPhones: [] as string[],
    dob: "", gender: "", guardianName: "", acquisitionSource: "", photoUrl: "",
    addressLine1: "", addressLine2: "", city: "", state: "", zip: "", country: "",
    joinDate: todayInput(),
    planId: "", planStartDate: todayInput(), priceOverride: "", comp: false, discountCode: "",
    tagIds: [] as string[],
    optInEmailMarketing: true, optInSmsMarketing: false,
    assignRequiredDocuments: true, sendSigningLink: true, sendAccessLink: true,
  });
  const [cf, setCf] = React.useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const plan = plans.find((p) => p.id === f.planId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.firstName.trim() || !f.lastName.trim() || !f.email.trim()) { setError("First name, last name and email are required."); return; }
    const missingCf = customFields.filter((c) => c.required && !(cf[c.id] ?? "").trim());
    if (missingCf.length) { setError(`Required: ${missingCf.map((c) => c.name).join(", ")}`); return; }
    setSaving(true);
    try {
      const r = await api<{ member: { id: string }; assignedDocuments: string[]; warnings: string[] }>(`/api/admin/members`, {
        method: "POST",
        json: {
          locationSlug: slug,
          type: f.type,
          firstName: f.firstName.trim(), lastName: f.lastName.trim(), email: f.email.trim(), phone: f.phone.trim(),
          secondaryEmails: f.secondaryEmails.filter(Boolean), secondaryPhones: f.secondaryPhones.filter(Boolean),
          dob: f.dob || undefined, gender: f.gender || undefined, guardianName: f.guardianName.trim() || undefined, acquisitionSource: f.acquisitionSource || undefined, photoUrl: f.photoUrl.trim() || undefined,
          addressLine1: f.addressLine1 || undefined, addressLine2: f.addressLine2 || undefined, city: f.city || undefined, state: f.state || undefined, zip: f.zip || undefined, country: f.country || undefined,
          joinDate: f.joinDate || undefined,
          planId: f.type === "member" && f.planId ? f.planId : undefined,
          planStartDate: f.planStartDate || undefined,
          priceOverrideCents: f.priceOverride ? Math.round(Number(f.priceOverride) * 100) : undefined,
          comp: f.comp,
          discountCode: f.discountCode.trim() || undefined,
          tagIds: f.tagIds,
          optInEmailMarketing: f.optInEmailMarketing, optInSmsMarketing: f.optInSmsMarketing, smsConsent: f.optInSmsMarketing,
          assignRequiredDocuments: f.assignRequiredDocuments, sendSigningLink: f.sendSigningLink, sendAccessLink: f.sendAccessLink,
          customFields: Object.keys(cf).length ? cf : undefined,
        },
      });
      toast({ tone: r.warnings?.length ? "info" : "success", title: `${f.firstName} ${f.lastName} added`, description: r.warnings?.length ? r.warnings.join(" · ") : r.assignedDocuments?.length ? `Sent: ${r.assignedDocuments.join(", ")}` : undefined });
      router.push(adminRoutes.loc.members.detail(slug, r.member.id));
    } catch (e) {
      setError(errMsg(e));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      {error && <div className="rounded-apple border border-apple-red/30 bg-apple-red/5 p-3 text-apple-sm text-apple-red">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Who are they?" />
            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                {(["member", "visitor"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => set("type", t)} className={`flex-1 rounded-apple border px-3 py-2 text-apple-sm font-medium ${f.type === t ? "border-apple-blue bg-apple-blue/5 text-apple-blue" : "border-apple-border text-apple-text-secondary hover:bg-apple-fill-secondary"}`}>
                    {t === "member" ? "Member" : "Visitor / lead"}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="First name *" value={f.firstName} onChange={(e) => set("firstName", e.target.value)} autoFocus />
                <Input label="Last name *" value={f.lastName} onChange={(e) => set("lastName", e.target.value)} />
                <Input label="Email *" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
                <Input label="Phone" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
                <Input label="Date of birth" type="date" value={f.dob} onChange={(e) => set("dob", e.target.value)} />
                <Select label="Gender" value={f.gender} onChange={(e) => set("gender", e.target.value)}>
                  {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </Select>
                <Input label="Parent / guardian" hint="For minors" value={f.guardianName} onChange={(e) => set("guardianName", e.target.value)} />
                <Select label="How did they hear about us?" value={f.acquisitionSource} onChange={(e) => set("acquisitionSource", e.target.value)}>
                  <option value="">Unknown</option>
                  {ACQUISITION_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
              <ListEditor label="Secondary emails" type="email" values={f.secondaryEmails} onChange={(v) => set("secondaryEmails", v)} />
              <ListEditor label="Secondary phones" type="tel" values={f.secondaryPhones} onChange={(v) => set("secondaryPhones", v)} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Address" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Input label="Street" value={f.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} /></div>
              <div className="sm:col-span-2"><Input label="Apt / suite" value={f.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} /></div>
              <Input label="City" value={f.city} onChange={(e) => set("city", e.target.value)} />
              <Input label="State" value={f.state} onChange={(e) => set("state", e.target.value)} />
              <Input label="ZIP" value={f.zip} onChange={(e) => set("zip", e.target.value)} />
              <Input label="Country" value={f.country} onChange={(e) => set("country", e.target.value)} />
            </div>
          </Card>

          {customFields.length > 0 && (
            <Card>
              <CardHeader title="Custom fields" />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {customFields.map((c) => <CustomFieldInput key={c.id} field={c} value={cf[c.id] ?? ""} onChange={(v) => setCf((s) => ({ ...s, [c.id]: v }))} />)}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {f.type === "member" && (
            <Card>
              <CardHeader title="Membership" subtitle="Optional — start a plan now" />
              <div className="mt-4 space-y-3">
                <Select label="Plan" value={f.planId} onChange={(e) => set("planId", e.target.value)}>
                  <option value="">No plan yet (Pending)</option>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — ${(p.priceCents / 100).toFixed(2)} / {p.billingCadence.toLowerCase()}</option>)}
                </Select>
                {f.planId && (
                  <>
                    <Input label="Start date" type="date" value={f.planStartDate} onChange={(e) => set("planStartDate", e.target.value)} />
                    <Input label="Price override ($)" type="number" min={0} step="0.01" placeholder={plan ? (plan.priceCents / 100).toFixed(2) : ""} value={f.priceOverride} onChange={(e) => set("priceOverride", e.target.value)} disabled={f.comp} />
                    <Checkbox label="Complimentary" checked={f.comp} onChange={(v) => set("comp", v)} />
                    <Input label="Discount code" value={f.discountCode} onChange={(e) => set("discountCode", e.target.value)} hint="Recorded as a note for billing to apply" />
                    {plan?.signupFeeCents ? <p className="text-apple-xs text-apple-text-tertiary">Signup fee ${(plan.signupFeeCents / 100).toFixed(2)} — create from Payments after saving.</p> : null}
                  </>
                )}
                <Input label="Joined" type="date" value={f.joinDate} onChange={(e) => set("joinDate", e.target.value)} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Tags" />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tags.length === 0 && <span className="text-apple-xs text-apple-text-tertiary">No tags defined yet.</span>}
              {tags.map((t) => {
                const on = f.tagIds.includes(t.id);
                return (
                  <button key={t.id} type="button" onClick={() => set("tagIds", on ? f.tagIds.filter((x) => x !== t.id) : [...f.tagIds, t.id])} className={on ? "" : "opacity-50 hover:opacity-100"}>
                    <TagChip name={t.name} color={t.color} />
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Onboarding" />
            <div className="mt-3 space-y-2">
              <Checkbox label="Email marketing opt-in" checked={f.optInEmailMarketing} onChange={(v) => set("optInEmailMarketing", v)} />
              <Checkbox label="SMS marketing opt-in" checked={f.optInSmsMarketing} onChange={(v) => set("optInSmsMarketing", v)} hint="Records consent as given to staff" />
              <hr className="border-apple-divider" />
              <Checkbox label={`Assign required documents${requiredDocs.length ? ` (${requiredDocs.map((d) => d.name).join(", ")})` : ""}`} checked={f.assignRequiredDocuments} onChange={(v) => set("assignRequiredDocuments", v)} hint={requiredDocs.length ? undefined : "No documents are marked required at signup."} />
              {f.assignRequiredDocuments && requiredDocs.length > 0 && <Checkbox label="Send signing link now" checked={f.sendSigningLink} onChange={(v) => set("sendSigningLink", v)} />}
              <Checkbox label="Send account access link" checked={f.sendAccessLink} onChange={(v) => set("sendAccessLink", v)} hint="One-time sign-in link to the member portal" />
            </div>
          </Card>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="link" iconLeft={<Send className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>
          Or invite them to sign up themselves
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => router.push(adminRoutes.loc.members.list(slug))} disabled={saving}>Cancel</Button>
          <Button type="submit" loading={saving} iconLeft={<UserPlus className="h-4 w-4" />}>{f.type === "member" ? "Create member" : "Create visitor"}</Button>
        </div>
      </div>

      <InviteModal slug={slug} open={inviteOpen} onClose={() => setInviteOpen(false)} defaults={{ name: `${f.firstName} ${f.lastName}`.trim(), email: f.email, phone: f.phone }} />
    </form>
  );
}

type SignupForm = { id: string; name: string; slug: string; url: string };

export function InviteModal({ slug, open, onClose, defaults }: { slug: string; open: boolean; onClose: () => void; defaults?: { name?: string; email?: string; phone?: string } }) {
  const { toast } = useToast();
  const [forms, setForms] = React.useState<SignupForm[]>([]);
  const [channel, setChannel] = React.useState<"EMAIL" | "SMS">("EMAIL");
  const [to, setTo] = React.useState("");
  const [name, setName] = React.useState("");
  const [formSlug, setFormSlug] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(defaults?.name ?? "");
    setTo(channel === "EMAIL" ? defaults?.email ?? "" : defaults?.phone ?? "");
    api<{ forms: SignupForm[] }>(`/api/admin/members/invite?locationSlug=${encodeURIComponent(slug)}`).then((r) => { setForms(r.forms ?? []); if (!formSlug && r.forms?.[0]) setFormSlug(r.forms[0].slug); }).catch(() => setForms([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => { setTo(channel === "EMAIL" ? defaults?.email ?? "" : defaults?.phone ?? ""); }, [channel, defaults?.email, defaults?.phone]);

  async function send() {
    setBusy(true);
    try {
      await api(`/api/admin/members/invite`, { method: "POST", json: { locationSlug: slug, channel, to: to.trim(), name: name.trim() || undefined, formSlug, message: message.trim() || undefined } });
      toast({ tone: "success", title: "Invitation sent" });
      onClose();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't send invitation", description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Invite to sign up" description="Sends a link to one of your public signup forms. They'll fill in their own details and payment." footer={
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button loading={busy} disabled={!to.trim() || !formSlug} onClick={() => void send()}>Send invite</Button>
      </div>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Select label="Send via" value={channel} onChange={(e) => setChannel(e.target.value as any)}>
            <option value="EMAIL">Email</option>
            <option value="SMS">Text message</option>
          </Select>
          <Input label={channel === "EMAIL" ? "Email address" : "Phone number"} type={channel === "EMAIL" ? "email" : "tel"} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Input label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="Signup form" value={formSlug} onChange={(e) => setFormSlug(e.target.value)}>
          {forms.length === 0 && <option value="">No active signup forms</option>}
          {forms.map((f) => <option key={f.id} value={f.slug}>{f.name}</option>)}
        </Select>
        <Textarea label="Personal note (optional)" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
    </Modal>
  );
}
