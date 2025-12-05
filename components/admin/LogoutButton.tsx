"use client";

import { useState } from "react";

export default function LogoutButton({
  className = "rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50",
  redirectTo = "/admin/login",
}: {
  className?: string;
  redirectTo?: string;
}) {
  const [loading, setLoading] = useState(false);

  return (
    <button
      className={className}
      disabled={loading}
      onClick={async () => {
        try {
          setLoading(true);
          await fetch("/api/logout", { method: "POST", credentials: "include" });
        } catch {
          // ignore — we'll still redirect
        } finally {
          // Hard client redirect so middleware can’t swallow server redirects.
          window.location.href = redirectTo;
        }
      }}
    >
      {loading ? "Logging out…" : "Log out"}
    </button>
  );
}
