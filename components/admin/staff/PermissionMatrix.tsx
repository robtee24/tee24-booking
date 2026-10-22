"use client";

import React from "react";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";

export type PermissionGroup = { key: string; label: string; permissions: Permission[] };
export type Preset = { label: string; description: string; permissions: Permission[] };
export type Grant = { permission: string; locationId: string | null };
export type LocationLite = { id: string; name: string; slug: string };

/** Build a Set key for a grant. */
export const grantKey = (permission: string, locationId: string | null) => `${permission}|${locationId ?? ""}`;

export function grantsToSet(grants: Grant[]): Set<string> {
  return new Set(grants.map((g) => grantKey(g.permission, g.locationId)));
}

export function setToGrants(set: Set<string>): Grant[] {
  return [...set].map((k) => {
    const [permission, loc] = k.split("|");
    return { permission, locationId: loc || null };
  });
}

/**
 * Checkbox matrix of permissions grouped like `PERMISSIONS`. When `perLocation`
 * is on, each assigned location gets its own column; otherwise a single
 * "All assigned locations" column writes `locationId: null` grants.
 */
export function PermissionMatrix({
  groups,
  presets,
  locations,
  value,
  onChange,
  disabled = false,
}: {
  groups: PermissionGroup[];
  presets: Record<string, Preset>;
  locations: LocationLite[];
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}) {
  const hasPerLocationGrants = React.useMemo(() => [...value].some((k) => !k.endsWith("|")), [value]);
  const [perLocation, setPerLocation] = React.useState(hasPerLocationGrants);
  React.useEffect(() => {
    if (hasPerLocationGrants) setPerLocation(true);
  }, [hasPerLocationGrants]);

  const columns: { id: string | null; label: string }[] =
    perLocation && locations.length > 0
      ? locations.map((l) => ({ id: l.id, label: l.name }))
      : [{ id: null, label: locations.length > 1 ? "All assigned locations" : locations[0]?.name ?? "All locations" }];

  function toggle(permission: string, locationId: string | null) {
    const next = new Set(value);
    const k = grantKey(permission, locationId);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onChange(next);
  }

  function setGroup(group: PermissionGroup, locationId: string | null, on: boolean) {
    const next = new Set(value);
    for (const p of group.permissions) {
      const k = grantKey(p, locationId);
      if (on) next.add(k);
      else next.delete(k);
    }
    onChange(next);
  }

  function applyPreset(key: string, mode: "replace" | "add") {
    const preset = presets[key];
    if (!preset) return;
    const next = mode === "replace" ? new Set<string>() : new Set(value);
    for (const col of columns) for (const p of preset.permissions) next.add(grantKey(p, col.id));
    onChange(next);
  }

  function clearAll() {
    onChange(new Set());
  }

  const isOn = (permission: string, locationId: string | null) => value.has(grantKey(permission, locationId));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-apple-sm border border-apple-border bg-apple-fill-secondary/60 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">Presets</span>
          {Object.entries(presets).map(([key, p]) => (
            <Button key={key} type="button" size="sm" variant="secondary" disabled={disabled} title={p.description} onClick={() => applyPreset(key, "replace")}>
              {p.label}
            </Button>
          ))}
          <Button type="button" size="sm" variant="ghost" disabled={disabled || value.size === 0} onClick={clearAll}>
            Clear all
          </Button>
        </div>
        {locations.length > 1 && (
          <label className="flex items-center gap-2 text-apple-xs text-apple-text-secondary">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-apple-blue"
              checked={perLocation}
              disabled={disabled}
              onChange={(e) => {
                const on = e.target.checked;
                setPerLocation(on);
                // Expand "all" grants into per-location grants (or collapse back).
                const next = new Set<string>();
                for (const k of value) {
                  const [perm, loc] = k.split("|");
                  if (on && !loc) for (const l of locations) next.add(grantKey(perm, l.id));
                  else if (!on) next.add(grantKey(perm, null));
                  else next.add(k);
                }
                onChange(next);
              }}
            />
            Set per location
          </label>
        )}
      </div>

      {locations.length === 0 && (
        <p className="rounded-apple-sm border border-apple-orange/30 bg-apple-orange/5 px-3 py-2 text-apple-xs text-apple-orange">
          Assign at least one location above — permissions only apply inside assigned locations.
        </p>
      )}

      <div className="overflow-x-auto rounded-apple-sm border border-apple-border">
        <table className="w-full min-w-[520px] text-apple-sm">
          <thead className="bg-apple-fill-secondary text-left text-apple-xs uppercase tracking-wider text-apple-text-tertiary">
            <tr>
              <th className="px-3 py-2 font-semibold">Permission</th>
              {columns.map((c) => (
                <th key={c.id ?? "all"} className="px-3 py-2 text-center font-semibold">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              return (
                <React.Fragment key={g.key}>
                  <tr className="border-t border-apple-divider bg-white">
                    <td className="px-3 py-2 font-semibold text-apple-text">{g.label}</td>
                    {columns.map((c) => {
                      const all = g.permissions.every((p) => isOn(p, c.id));
                      const some = !all && g.permissions.some((p) => isOn(p, c.id));
                      return (
                        <td key={c.id ?? "all"} className="px-3 py-2 text-center">
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => setGroup(g, c.id, !all)}
                            className={`text-apple-xs font-medium hover:underline ${all ? "text-apple-red" : some ? "text-apple-blue" : "text-apple-blue"}`}
                          >
                            {all ? "Clear group" : "Grant all in group"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                  {g.permissions.map((p) => (
                    <tr key={p} className="border-t border-apple-divider/60 hover:bg-apple-fill-secondary/40">
                      <td className="px-3 py-1.5">
                        <div className="text-apple-sm text-apple-text">{PERMISSIONS[p]}</div>
                        <div className="font-mono text-[10px] text-apple-text-tertiary">{p}</div>
                      </td>
                      {columns.map((c) => (
                        <td key={c.id ?? "all"} className="px-3 py-1.5 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${PERMISSIONS[p]} — ${c.label}`}
                            className="h-4 w-4 accent-apple-blue"
                            checked={isOn(p, c.id)}
                            disabled={disabled}
                            onChange={() => toggle(p, c.id)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-apple-xs text-apple-text-tertiary">
        {value.size} grant{value.size === 1 ? "" : "s"} selected. ROOT and FULL admins have every permission implicitly.
      </p>
    </div>
  );
}
