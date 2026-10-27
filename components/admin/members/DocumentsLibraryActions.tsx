"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { api, errMsg } from "./shared";

export function DocumentsLibraryActions({ slug, id, active }: { slug: string; id: string; active: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function setActive(next: boolean) {
    setBusy(true);
    try {
      await api(`/api/admin/documents/${id}`, { method: "PATCH", json: { active: next } });
      toast({ tone: "success", title: next ? "Document restored" : "Document retired" });
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't update document", description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      <Link href={adminRoutes.loc.members.documentEdit(slug, id)}>
        <Button size="sm" variant="secondary">Edit</Button>
      </Link>
      {active ? (
        <Button size="sm" variant="ghost" loading={busy} onClick={() => { if (window.confirm("Retire this document? Existing signatures stay on file; it won't be assigned to new members.")) void setActive(false); }}>
          Retire
        </Button>
      ) : (
        <Button size="sm" variant="ghost" loading={busy} onClick={() => void setActive(true)}>
          Restore
        </Button>
      )}
    </div>
  );
}
