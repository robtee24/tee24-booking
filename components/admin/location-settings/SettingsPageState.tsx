"use client";

import React from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Loading skeleton / error card wrapper for client-fetched settings pages. */
export function SettingsPageState({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="animate-pulse space-y-4" aria-busy>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 rounded-apple border border-apple-divider bg-white" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-apple border border-apple-red/30 bg-apple-red/5 p-4 text-apple-sm text-apple-red sm:flex-row sm:items-center">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <span className="flex-1">{error}</span>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    );
  }
  return <>{children}</>;
}
