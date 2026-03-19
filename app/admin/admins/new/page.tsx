"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Loc = { id: string; name: string };

export default function Page() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-apple-2xl font-semibold tracking-tight text-apple-text">Add New Admin</h1>
        <p className="mt-1 text-apple-base text-apple-text-secondary">Create a new admin account with the appropriate role and access.</p>
      </div>
      <NewAdminForm />
    </div>
  );
}

function NewAdminForm() {
  const router = useRouter();
  const [locations, setLocations] = useState<Loc[]>([]);
  const [role, setRole] = useState<"SCOPED" | "FULL" | "ROOT">("SCOPED");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/admin/locations", { cache: "no-store" });
        const j = await r.json();
        if (!cancelled) setLocations(j.locations || []);
      } catch {
        if (!cancelled) setLocations([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function toggleLocation(id: string) {
    setSelectedLocations((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const fd = new FormData(e.currentTarget);
    const name = (fd.get("name") || "") as string;
    const rawPhone = (fd.get("phone") || "") as string;

    const res = await fetch("/api/admin/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || null,
        phone: rawPhone,
        role,
        locationIds: role === "SCOPED" ? selectedLocations : [],
      }),
    });

    setLoading(false);
    if (res.ok) {
      router.push("/admin/admins");
    } else {
      const j = await res.json().catch(() => ({}));
      alert(j?.error || "Failed to create admin.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card max-w-lg p-6 space-y-5">
      <div>
        <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Name</label>
        <input name="name" className="input" placeholder="Optional" />
      </div>

      <div>
        <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Phone Number</label>
        <input name="phone" className="input" required placeholder="+13361234567" />
      </div>

      <div>
        <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value as any)} className="input">
          <option value="SCOPED">Scoped (specific locations)</option>
          <option value="FULL">Full (all locations)</option>
          <option value="ROOT">Root (manage admins)</option>
        </select>
      </div>

      {role === "SCOPED" && (
        <div>
          <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Locations</label>
          <div className="mt-1.5 space-y-1 rounded-apple-sm border border-apple-border p-3">
            {locations.map((loc) => (
              <label key={loc.id} className="flex cursor-pointer items-center gap-2.5 rounded-apple-sm px-2 py-1.5 transition-colors hover:bg-apple-fill-secondary">
                <input
                  type="checkbox"
                  checked={selectedLocations.includes(loc.id)}
                  onChange={() => toggleLocation(loc.id)}
                  className="h-4 w-4 rounded accent-apple-blue"
                />
                <span className="text-apple-sm text-apple-text">{loc.name}</span>
              </label>
            ))}
            {locations.length === 0 && (
              <div className="text-apple-sm text-apple-text-tertiary">No locations yet.</div>
            )}
          </div>
        </div>
      )}

      <button disabled={loading} className="btn-primary">
        {loading ? "Creating..." : "Create Admin"}
      </button>
    </form>
  );
}
