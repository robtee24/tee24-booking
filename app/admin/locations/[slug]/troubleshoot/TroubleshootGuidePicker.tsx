"use client";

import React from "react";
import { TroubleshootGuide } from "@/components/admin/TroubleshootGuide";
import { COMMON_NODE_ID, type TroubleshootTree } from "@/lib/kiosk/troubleshooting";
import { cn } from "@/lib/utils";

export function TroubleshootGuidePicker({ tree, entries }: { tree: TroubleshootTree; entries: { id: string; label: string }[] }) {
  const options = React.useMemo(() => {
    const base = entries.length ? entries : [{ id: "idra_menu", label: tree.idra_menu?.category ?? "IDRA" }];
    const hasCommon = base.some((e) => e.id === COMMON_NODE_ID);
    return hasCommon ? base : [...base, { id: COMMON_NODE_ID, label: "Other (PC, projector, doors)" }];
  }, [entries, tree]);
  const [entry, setEntry] = React.useState(options[0]?.id ?? COMMON_NODE_ID);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setEntry(o.id)}
            className={cn(
              "rounded-apple-pill border px-3 py-1.5 text-apple-sm font-medium transition-colors",
              entry === o.id ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border bg-white text-apple-text-secondary hover:text-apple-text"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <TroubleshootGuide tree={tree} entryNodeId={entry} />
    </div>
  );
}
