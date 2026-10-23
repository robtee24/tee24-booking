"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Send, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Modal, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import type { StaffAdminDTO } from "./AdminForm";

export function InviteBadge({ status, size = "md" }: { status: string; size?: "sm" | "md" }) {
  return status === "ACTIVE" ? (
    <Badge tone="success" size={size}>Active</Badge>
  ) : (
    <Badge tone="warn" size={size}>Invited</Badge>
  );
}

/** Invite / delete actions for the admin detail page. */
export function AdminActionsPanel({ admin, canDelete }: { admin: StaffAdminDTO; canDelete: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  async function call(path: string, init: RequestInit, label: string) {
    setBusy(label);
    try {
      const res = await fetch(path, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      return json;
    } catch (e: unknown) {
      toast({ tone: "error", title: `${label} failed`, description: e instanceof Error ? e.message : undefined });
      throw e;
    } finally {
      setBusy(null);
    }
  }

  async function resendInvite() {
    const r = await call(`/api/admin/admins/${encodeURIComponent(admin.id)}/invite`, { method: "POST" }, "Resend invite").catch(() => null);
    if (r) {
      toast({
        tone: "success",
        title: r.dryRun ? "Invite logged (dry run)" : "Invite sent",
        description: `SMS ${r.sms ? "sent" : "failed"}${admin.email ? ` · email ${r.email ? "sent" : "failed"}` : ""}`,
      });
      router.refresh();
    }
  }

  async function remove() {
    const r = await call(`/api/admin/admins/${encodeURIComponent(admin.id)}`, { method: "DELETE" }, "Delete").catch(() => null);
    if (r) {
      toast({ tone: "success", title: "Admin deleted" });
      router.push(adminRoutes.admins());
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Status" action={<InviteBadge status={admin.inviteStatus} />} />
        <dl className="mt-3 space-y-1.5 text-apple-sm">
          <Row label="Invited">{admin.invitedAt ? new Date(admin.invitedAt).toLocaleString() : "—"}</Row>
          <Row label="Last login">{admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : "Never"}</Row>
          <Row label="Created">{new Date(admin.createdAt).toLocaleDateString()}</Row>
          <Row label="2FA">
            {admin.twoFactorEnabled ? (
              <span className="inline-flex items-center gap-1 text-apple-green"><ShieldCheck className="h-3.5 w-3.5" /> Enabled</span>
            ) : (
              <span className="text-apple-text-tertiary">Off</span>
            )}
          </Row>
        </dl>
        <div className="mt-4">
          <Button size="sm" variant="secondary" iconLeft={<Send className="h-3.5 w-3.5" />} loading={busy === "Resend invite"} onClick={() => void resendInvite()}>
            {admin.inviteStatus === "ACTIVE" ? "Send login link" : "Resend invite"}
          </Button>
        </div>
      </Card>

      {canDelete && (
        <Card>
          <CardHeader title="Danger zone" />
          <p className="mt-2 text-apple-xs text-apple-text-tertiary">Removes this admin&apos;s access immediately. Their tasks become unassigned; the audit trail is kept.</p>
          <div className="mt-3">
            <Button size="sm" variant="danger" iconLeft={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmDelete(true)}>
              Delete admin
            </Button>
          </div>
        </Card>
      )}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${admin.name || admin.phone}?`}
        description="This cannot be undone."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Keep admin</Button>
            <Button variant="danger" loading={busy === "Delete"} onClick={() => void remove()}>Delete admin</Button>
          </div>
        }
      >
        <span className="sr-only">Confirm deletion</span>
      </Modal>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-apple-text-secondary">{label}</dt>
      <dd className="text-right text-apple-text">{children}</dd>
    </div>
  );
}
