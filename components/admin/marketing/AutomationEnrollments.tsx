"use client";

import React from "react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, Select, StatusBadge, useToast } from "@/components/ui";
import { UserPlus, X } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { useAdminLocation } from "@/components/admin/LocationContext";
import { MemberSearch, fmtDate, useErrorToast, useMarketingApi } from "./shared";

type Enrollment = { id: string; status: string; currentStep: number; nextRunAt: string | null; enrolledAt: string; exitReason: string | null; member: { id: string; firstName: string; lastName: string; email: string; status: string } };

export function AutomationEnrollments({ automationId, initial }: { automationId: string; initial: Enrollment[] }) {
  const api = useMarketingApi();
  const { slug } = useAdminLocation();
  const { toast } = useToast();
  const onError = useErrorToast();
  const [items, setItems] = React.useState<Enrollment[]>(initial);
  const [status, setStatus] = React.useState("");
  const [picked, setPicked] = React.useState<{ id: string; firstName: string; lastName: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function reload(st = status) {
    try {
      const res = await api<{ items: Enrollment[] }>(`/api/admin/marketing/automations/${automationId}/enrollments${st ? `?status=${st}` : ""}`);
      setItems(res.items);
    } catch (e) {
      onError(e);
    }
  }

  async function enroll() {
    if (!picked) return;
    setBusy("enroll");
    try {
      await api(`/api/admin/marketing/automations/${automationId}/enrollments`, { method: "POST", json: { memberId: picked.id } });
      toast({ tone: "success", title: `Enrolled ${picked.firstName} ${picked.lastName}` });
      setPicked(null);
      await reload();
    } catch (e) {
      onError(e, "Enroll failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await api(`/api/admin/marketing/automations/${automationId}/enrollments?enrollmentId=${id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card padded={false}>
      <div className="flex flex-col gap-3 border-b border-apple-divider px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <CardHeader title="Enrollments" subtitle={`${items.length} shown`} className="!mb-0" />
        <div className="flex items-center gap-2">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); void reload(e.target.value); }} aria-label="Filter status">
            <option value="">All</option>
            {["ACTIVE", "COMPLETED", "EXITED", "FAILED"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-b border-apple-divider bg-apple-fill-secondary/40 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex-1"><MemberSearch onPick={(m) => setPicked(m)} placeholder="Manually enroll a member…" /></div>
        <Button size="sm" iconLeft={<UserPlus className="h-4 w-4" />} onClick={enroll} disabled={!picked} loading={busy === "enroll"}>
          Enroll{picked ? ` ${picked.firstName}` : ""}
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="p-6 text-center text-apple-sm text-apple-text-tertiary">No enrollments yet.</p>
      ) : (
        <ul className="divide-y divide-apple-divider">
          {items.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-apple-sm">
              <div className="min-w-0">
                <Link href={adminRoutes.loc.members.detail(slug, e.member.id)} className="font-medium text-apple-text hover:text-apple-blue">
                  {e.member.firstName} {e.member.lastName}
                </Link>
                <div className="text-apple-xs text-apple-text-tertiary">
                  Step {e.currentStep + 1} · enrolled {fmtDate(e.enrolledAt)}
                  {e.status === "ACTIVE" && e.nextRunAt ? ` · next ${fmtDate(e.nextRunAt)}` : ""}
                  {e.exitReason ? ` · ${e.exitReason}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={e.status} size="sm" />
                {e.member.status !== "ACTIVE" && <Badge tone="muted" size="sm">{e.member.status}</Badge>}
                {e.status === "ACTIVE" && (
                  <Button size="sm" variant="ghost" onClick={() => remove(e.id)} loading={busy === e.id} aria-label="Remove from automation">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
