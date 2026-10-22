"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Drawer, Input, Select, useToast } from "@/components/ui";
import { ACQUISITION_SOURCES, Checkbox, GENDERS, api, errMsg, toDateInput } from "./shared";

export type EditableMember = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  photoUrl: string | null;
  secondaryEmails: string[];
  secondaryPhones: string[];
  dob: string | null;
  gender: string | null;
  guardianName: string | null;
  joinDate: string | null;
  membershipType: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  acquisitionSource: string | null;
  optInEmailMarketing: boolean;
  optInSmsMarketing: boolean;
  smsConsentAt: string | null;
  checkinCode: string | null;
  kisiAccessEnabled: boolean;
  kisiAccessReason: string | null;
  magicLinkLastSentAt: string | null;
};

export type CustomField = { id: string; name: string; type: string; options: unknown; required: boolean };

export function customValueToString(field: CustomField, raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (Array.isArray(raw)) return raw.join(", ");
  if (typeof raw === "boolean") return raw ? "true" : "false";
  if ((field.type || "").toUpperCase() === "DATE") return toDateInput(String(raw));
  return String(raw);
}

function fieldOptions(field: CustomField): string[] {
  const o = field.options;
  if (Array.isArray(o)) return o.map(String);
  if (o && typeof o === "object" && Array.isArray((o as { options?: unknown[] }).options)) return (o as { options: unknown[] }).options.map(String);
  return [];
}

export function EditMemberDrawer({
  slug,
  member,
  open,
  onClose,
  onSaved,
}: {
  slug: string;
  member: EditableMember;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState(() => toForm(member));
  const [fields, setFields] = React.useState<CustomField[]>([]);
  const [fieldValues, setFieldValues] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    setForm(toForm(member));
    setError(null);
    api<{ fields: CustomField[]; values: Record<string, unknown> }>(`/api/admin/custom-fields?locationSlug=${encodeURIComponent(slug)}&memberId=${member.id}`)
      .then((r) => {
        setFields(r.fields ?? []);
        setFieldValues(Object.fromEntries((r.fields ?? []).map((f) => [f.id, customValueToString(f, r.values?.[f.id])])));
      })
      .catch(() => setFields([]));
  }, [open, member, slug]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/admin/members/${member.id}`, {
        method: "PATCH",
        json: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          photoUrl: form.photoUrl.trim() || null,
          secondaryEmails: form.secondaryEmails.map((s) => s.trim()).filter(Boolean),
          secondaryPhones: form.secondaryPhones.map((s) => s.trim()).filter(Boolean),
          dob: form.dob || null,
          gender: form.gender || null,
          guardianName: form.guardianName.trim() || null,
          joinDate: form.joinDate || null,
          membershipType: form.membershipType.trim() || null,
          addressLine1: form.addressLine1.trim() || null,
          addressLine2: form.addressLine2.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim() || null,
          zip: form.zip.trim() || null,
          country: form.country.trim() || null,
          acquisitionSource: form.acquisitionSource || null,
          optInEmailMarketing: form.optInEmailMarketing,
          optInSmsMarketing: form.optInSmsMarketing,
          smsConsent: form.optInSmsMarketing,
          customFields: fields.length ? fieldValues : undefined,
        },
      });
      toast({ tone: "success", title: "Member updated" });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Edit member details"
      width="lg"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} loading={saving}>Save changes</Button>
        </div>
      }
    >
      <div className="space-y-6">
        {error && <div className="rounded-apple border border-apple-red/30 bg-apple-red/5 p-3 text-apple-sm text-apple-red">{error}</div>}

        <Section title="Identity">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="First name" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} required />
            <Input label="Last name" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} required />
            <Input label="Date of birth" type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} />
            <Select label="Gender" value={form.gender} onChange={(e) => set("gender", e.target.value)}>
              {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </Select>
            <Input label="Parent / guardian" hint="For minors" value={form.guardianName} onChange={(e) => set("guardianName", e.target.value)} />
            <Input label="Photo URL" value={form.photoUrl} onChange={(e) => set("photoUrl", e.target.value)} placeholder="https://" />
          </div>
        </Section>

        <Section title="Contact">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Primary email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
            <Input label="Primary phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <ListEditor label="Secondary emails" placeholder="name@example.com" type="email" values={form.secondaryEmails} onChange={(v) => set("secondaryEmails", v)} />
          <ListEditor label="Secondary phones" placeholder="(555) 555-5555" type="tel" values={form.secondaryPhones} onChange={(v) => set("secondaryPhones", v)} />
        </Section>

        <Section title="Address">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Input label="Street" value={form.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} /></div>
            <div className="sm:col-span-2"><Input label="Apt / suite" value={form.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} /></div>
            <Input label="City" value={form.city} onChange={(e) => set("city", e.target.value)} />
            <Input label="State" value={form.state} onChange={(e) => set("state", e.target.value)} />
            <Input label="ZIP" value={form.zip} onChange={(e) => set("zip", e.target.value)} />
            <Input label="Country" value={form.country} onChange={(e) => set("country", e.target.value)} />
          </div>
        </Section>

        <Section title="Membership">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Joined" type="date" value={form.joinDate} onChange={(e) => set("joinDate", e.target.value)} />
            <Input label="Membership type (label)" value={form.membershipType} onChange={(e) => set("membershipType", e.target.value)} placeholder="e.g. Unlimited" />
            <Select label="How did they hear about us?" value={form.acquisitionSource} onChange={(e) => set("acquisitionSource", e.target.value)}>
              <option value="">Unknown</option>
              {ACQUISITION_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              {form.acquisitionSource && !ACQUISITION_SOURCES.includes(form.acquisitionSource) && <option value={form.acquisitionSource}>{form.acquisitionSource}</option>}
            </Select>
          </div>
        </Section>

        <Section title="Marketing preferences">
          <div className="space-y-2">
            <Checkbox label="Email marketing opt-in" checked={form.optInEmailMarketing} onChange={(v) => set("optInEmailMarketing", v)} />
            <Checkbox
              label="SMS marketing opt-in"
              hint={member.smsConsentAt ? `Consent recorded ${new Date(member.smsConsentAt).toLocaleDateString()}` : "Turning this on records consent as given by staff."}
              checked={form.optInSmsMarketing}
              onChange={(v) => set("optInSmsMarketing", v)}
            />
          </div>
        </Section>

        {fields.length > 0 && (
          <Section title="Custom fields">
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <CustomFieldInput key={f.id} field={f} value={fieldValues[f.id] ?? ""} onChange={(v) => setFieldValues((s) => ({ ...s, [f.id]: v }))} />
              ))}
            </div>
          </Section>
        )}
      </div>
    </Drawer>
  );
}

function toForm(m: EditableMember) {
  return {
    firstName: m.firstName ?? "",
    lastName: m.lastName ?? "",
    email: m.email ?? "",
    phone: m.phone ?? "",
    photoUrl: m.photoUrl ?? "",
    secondaryEmails: m.secondaryEmails ?? [],
    secondaryPhones: m.secondaryPhones ?? [],
    dob: toDateInput(m.dob),
    gender: m.gender ?? "",
    guardianName: m.guardianName ?? "",
    joinDate: toDateInput(m.joinDate),
    membershipType: m.membershipType ?? "",
    addressLine1: m.addressLine1 ?? "",
    addressLine2: m.addressLine2 ?? "",
    city: m.city ?? "",
    state: m.state ?? "",
    zip: m.zip ?? "",
    country: m.country ?? "",
    acquisitionSource: m.acquisitionSource ?? "",
    optInEmailMarketing: !!m.optInEmailMarketing,
    optInSmsMarketing: !!m.optInSmsMarketing,
  };
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">{title}</h3>
      {children}
    </section>
  );
}

export function ListEditor({
  label,
  values,
  onChange,
  placeholder,
  type,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-apple-xs font-medium text-apple-text-secondary">{label}</span>
        <button type="button" onClick={() => onChange([...values, ""])} className="inline-flex items-center gap-1 text-apple-xs font-medium text-apple-blue hover:underline">
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      {values.length === 0 && <p className="text-apple-xs text-apple-text-tertiary">None</p>}
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input type={type} value={v} placeholder={placeholder} onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} className="rounded-apple-sm p-2 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-red" aria-label="Remove">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CustomFieldInput({ field, value, onChange }: { field: CustomField; value: string; onChange: (v: string) => void }) {
  const t = (field.type || "TEXT").toUpperCase();
  const label = field.required ? `${field.name} *` : field.name;
  if (t === "SELECT" || t === "DROPDOWN" || t === "MULTI_SELECT") {
    if (t === "MULTI_SELECT") {
      const selected = value.split(",").map((s) => s.trim()).filter(Boolean);
      return (
        <div>
          <span className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">{label}</span>
          <div className="flex flex-wrap gap-2">
            {fieldOptions(field).map((o) => (
              <Checkbox
                key={o}
                label={o}
                checked={selected.includes(o)}
                onChange={(on) => onChange((on ? [...selected, o] : selected.filter((s) => s !== o)).join(", "))}
              />
            ))}
          </div>
        </div>
      );
    }
    return (
      <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {fieldOptions(field).map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    );
  }
  if (t === "BOOLEAN" || t === "CHECKBOX") {
    return (
      <div className="pt-6">
        <Checkbox label={label} checked={value === "true" || value === "yes" || value === "1"} onChange={(v) => onChange(v ? "true" : "false")} />
      </div>
    );
  }
  const inputType = t === "DATE" ? "date" : t === "NUMBER" ? "number" : t === "EMAIL" ? "email" : t === "PHONE" ? "tel" : "text";
  return <Input label={label} type={inputType} value={value} onChange={(e) => onChange(e.target.value)} />;
}
