"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, useToast } from "@/components/ui";
import { Sparkles } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { useAdminLocation } from "@/components/admin/LocationContext";
import { useErrorToast, useMarketingApi } from "./shared";

export function AutomationGallery({ presets }: { presets: { key: string; name: string; description: string; steps: number; trigger: string }[] }) {
  const api = useMarketingApi();
  const router = useRouter();
  const { slug } = useAdminLocation();
  const { toast } = useToast();
  const onError = useErrorToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function use(key: string) {
    setBusy(key);
    try {
      const res = await api<{ automation: { id: string } }>("/api/admin/marketing/automations/presets", { method: "POST", json: { key } });
      toast({ tone: "success", title: "Automation created from template", description: "Review the steps, then activate." });
      router.push(adminRoutes.loc.marketing.automationDetail(slug, res.automation.id));
    } catch (e) {
      onError(e);
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader title="Templates gallery" subtitle="Prebuilt flows — created paused so you can review before activating." />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {presets.map((p) => (
          <div key={p.key} className="flex flex-col justify-between rounded-apple border border-apple-border p-4">
            <div>
              <div className="flex items-center gap-2 text-apple-sm font-semibold text-apple-text">
                <Sparkles className="h-4 w-4 text-apple-blue" /> {p.name}
              </div>
              <p className="mt-1 text-apple-xs text-apple-text-secondary">{p.description}</p>
              <p className="mt-2 font-mono text-[10px] text-apple-text-tertiary">{p.trigger} · {p.steps} steps</p>
            </div>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => use(p.key)} loading={busy === p.key}>
              Use template
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
