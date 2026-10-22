"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";

/**
 * Admin error boundary. Replaces the raw Next.js "Application error" screen with
 * an in-shell message, a retry button, and the error digest for support.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-apple-red/10 text-apple-red">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <h1 className="text-apple-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-apple-base text-apple-text-secondary">
        This page hit an error while loading. You can try again, or head back to the overview.
      </p>
      {process.env.NODE_ENV !== "production" && error?.message && (
        <pre className="mt-4 max-w-full overflow-x-auto rounded-apple-sm bg-apple-fill-secondary p-3 text-left text-apple-xs text-apple-text-secondary">
          {error.message}
        </pre>
      )}
      {error?.digest && (
        <p className="mt-3 text-apple-xs text-apple-text-tertiary">
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button onClick={() => reset()} className="btn-primary inline-flex items-center gap-2">
          <RotateCcw className="h-4 w-4" />
          Try again
        </button>
        <Link href={adminRoutes.home()} className="btn-secondary">
          Go to overview
        </Link>
      </div>
    </div>
  );
}
