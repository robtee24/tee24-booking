"use client";

import React from "react";
import { Input } from "@/components/ui";

export type MemberOption = { id: string; firstName: string; lastName: string; email: string };

/** Typeahead over a pre-loaded member list (no extra API needed). */
export function MemberPicker({ label = "Member", members, value, onChange, disabled }: { label?: string; members: MemberOption[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const selected = members.find((m) => m.id === value);
  const [query, setQuery] = React.useState(selected ? `${selected.firstName} ${selected.lastName}` : "");
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (selected) setQuery(`${selected.firstName} ${selected.lastName}`);
  }, [selected]);

  const q = query.trim().toLowerCase();
  const matches = q.length === 0 ? members.slice(0, 8) : members.filter((m) => `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(q)).slice(0, 8);

  return (
    <div className="relative">
      <Input
        label={label}
        value={query}
        disabled={disabled}
        placeholder="Search by name or email…"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange("");
        }}
        hint={selected ? selected.email : undefined}
      />
      {open && !disabled && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-apple border border-apple-border bg-white py-1 shadow-apple-md">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-apple-sm hover:bg-apple-fill-secondary"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(m.id);
                  setQuery(`${m.firstName} ${m.lastName}`);
                  setOpen(false);
                }}
              >
                <span className="font-medium text-apple-text">{m.firstName} {m.lastName}</span>
                <span className="truncate pl-3 text-apple-xs text-apple-text-tertiary">{m.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
