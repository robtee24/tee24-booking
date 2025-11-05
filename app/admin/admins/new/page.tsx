"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Loc = { id: string; name: string };

export default function Page() {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Add New Admin</h1>
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
    return () => {
      cancelled = true;
    };
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
    <form onSubmit={handleSubmit} className="max-w-md space-y-4">
      <div>
        <label className="block text-sm font-medium">Name</label>
        <input
          name="name"
          className="mt-1 w-full rounded-md border p-2"
          placeholder="Optional"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Phone Number</label>
        <input
          name="phone"
          className="mt-1 w-full rounded-md border p-2"
          required
          placeholder="+13361234567"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as any)}
          className="mt-1 w-full rounded-md border p-2"
        >
          <option value="SCOPED">Scoped (specific locations)</option>
          <option value="FULL">Full (all locations)</option>
          <option value="ROOT">Root (manage admins)</option>
        </select>
      </div>

      {role === "SCOPED" && (
        <div>
          <label className="block text-sm font-medium">Locations</label>
          <div className="mt-2 space-y-1 rounded-md border p-2">
            {locations.map((loc) => (
              <label key={loc.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedLocations.includes(loc.id)}
                  onChange={() => toggleLocation(loc.id)}
                />
                {loc.name}
              </label>
            ))}
            {locations.length === 0 && (
              <div className="text-sm text-neutral-500">No locations yet.</div>
            )}
          </div>
        </div>
      )}

      <button
        disabled={loading}
        className="rounded-md bg-black px-4 py-2 text-white hover:bg-neutral-800 disabled:opacity-60"
      >
        {loading ? "Creating..." : "Create Admin"}
      </button>
    </form>
  );
}
