"use client";

import React from "react";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import type { SquareStatus } from "@/app/api/admin/billing/_shared";

/**
 * Banner shown on billing pages when this location has no Square connection.
 * The actual connection form lives on Billing → Settings (`SquareConnectForm`).
 */
export function SquareConnectCallout({ status, slug }: { status: SquareStatus; slug: string }) {
  if (status.configured) return null;
  return (
    <div className="rounded-apple border border-apple-orange/40 bg-apple-orange/5 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-orange/15 text-apple-orange">
          <CreditCard className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-apple-base font-semibold text-apple-text">Connect this location&apos;s Square account to accept card payments</h3>
          <p className="mt-1 text-apple-sm text-apple-text-secondary">
            Cards on file, automatic recurring charges, online signup payments, POS card entry and refunds are disabled until Square is connected. Manual payments (cash / check / other) still work.
          </p>
          <Link href={adminRoutes.loc.billing.settings(slug)} className="mt-3 inline-flex text-apple-sm font-medium text-apple-blue hover:underline">
            Connect Square in Billing settings →
          </Link>
        </div>
      </div>
    </div>
  );
}
