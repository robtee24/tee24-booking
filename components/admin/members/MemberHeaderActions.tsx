"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Eye, KeyRound, MoreVertical, Pencil, UserCheck } from "lucide-react";
import { Button, Modal, useToast } from "@/components/ui";
import { EditMemberDrawer, type EditableMember } from "./EditMemberDrawer";
import { api, errMsg } from "./shared";

export function MemberHeaderActions({ slug, member }: { slug: string; member: EditableMember }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmConvert, setConfirmConvert] = React.useState(false);
  const [accessOpen, setAccessOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  async function viewAs() {
    if (!window.confirm(`Open the member portal as ${member.firstName} ${member.lastName}? Your activity will be audit-logged.`)) return;
    setBusy("view");
    try {
      const json = await api<{ redirectUrl?: string }>("/api/portal/impersonation/start", { method: "POST", json: { memberId: member.id } });
      window.open(json.redirectUrl ?? "/portal", "_blank");
    } catch (e) {
      toast({ tone: "error", title: "Couldn't start impersonation", description: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  async function convert() {
    setBusy("convert");
    try {
      await api(`/api/admin/members/${member.id}/convert`, { method: "POST" });
      toast({ tone: "success", title: "Converted to member" });
      setConfirmConvert(false);
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't convert", description: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  async function sendAccess(channel: "EMAIL" | "SMS") {
    setBusy("access");
    try {
      await api(`/api/admin/members/${member.id}/access-link`, { method: "POST", json: { channel } });
      toast({ tone: "success", title: `Access link sent by ${channel === "SMS" ? "text" : "email"}` });
      setAccessOpen(false);
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't send link", description: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button variant="secondary" iconLeft={<Pencil className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
        Edit details
      </Button>
      <Button variant="danger" iconLeft={<Eye className="h-4 w-4" />} loading={busy === "view"} onClick={() => void viewAs()}>
        View as member
      </Button>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-apple-sm border border-apple-border bg-white p-2.5 text-apple-text hover:bg-apple-fill-secondary"
          aria-label="More actions"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-apple border border-apple-border bg-white py-1 shadow-apple-md">
            <MenuItem icon={<KeyRound className="h-4 w-4" />} onClick={() => { setMenuOpen(false); setAccessOpen(true); }}>
              Send account access
            </MenuItem>
            {member.status === "VISITOR" && (
              <MenuItem icon={<UserCheck className="h-4 w-4" />} onClick={() => { setMenuOpen(false); setConfirmConvert(true); }}>
                Convert to member
              </MenuItem>
            )}
          </div>
        )}
      </div>

      <EditMemberDrawer slug={slug} member={member} open={editOpen} onClose={() => setEditOpen(false)} onSaved={() => router.refresh()} />

      <Modal
        open={confirmConvert}
        onClose={() => setConfirmConvert(false)}
        title="Convert visitor to member?"
        description="The record becomes a member (Active if they already have a plan, otherwise Pending). You can add a membership from the Memberships tab."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setConfirmConvert(false)}>Cancel</Button>
            <Button onClick={() => void convert()} loading={busy === "convert"}>Convert</Button>
          </div>
        }
      >
        <p className="text-apple-sm text-apple-text-secondary">Visitor history (visits, messages) is kept on the same record.</p>
      </Modal>

      <Modal
        open={accessOpen}
        onClose={() => setAccessOpen(false)}
        title="Send account access"
        description="Emails or texts a one-time sign-in link to the member portal (expires in 15 minutes)."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setAccessOpen(false)}>Cancel</Button>
            <Button variant="secondary" onClick={() => void sendAccess("SMS")} loading={busy === "access"} disabled={!member.phone}>Text {member.phone}</Button>
            <Button onClick={() => void sendAccess("EMAIL")} loading={busy === "access"} disabled={!member.email}>Email {member.email}</Button>
          </div>
        }
      >
        <p className="text-apple-sm text-apple-text-secondary">
          {member.magicLinkLastSentAt ? `Last sent ${new Date(member.magicLinkLastSentAt).toLocaleString()}.` : "No access link has been sent yet."}
        </p>
      </Modal>
    </>
  );
}

function MenuItem({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 px-3 py-2 text-left text-apple-sm text-apple-text hover:bg-apple-fill-secondary">
      <span className="text-apple-text-tertiary">{icon}</span>
      {children}
    </button>
  );
}
