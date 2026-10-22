"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button, useToast } from "@/components/ui";

export function ResendInviteButton({ adminId }: { adminId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  async function resend() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/admins/${encodeURIComponent(adminId)}/invite`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ tone: "success", title: json.dryRun ? "Invite logged (dry run)" : "Invite sent", description: `SMS ${json.sms ? "sent" : "failed"}` });
      router.refresh();
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't send invite", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="ghost" iconLeft={<Send className="h-3.5 w-3.5" />} loading={busy} onClick={() => void resend()}>
      Resend
    </Button>
  );
}
