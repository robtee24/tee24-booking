"use client";

import { useParams } from "next/navigation";

export default function ClientDebug() {
  const p = useParams(); // always available in client components
  return (
    <div className="rounded-md border p-3">
      <div className="text-sm font-medium">Client params</div>
      <pre className="text-xs text-gray-700 whitespace-pre-wrap">
{JSON.stringify(p, null, 2)}
      </pre>
    </div>
  );
}