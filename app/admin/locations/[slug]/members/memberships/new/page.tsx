"use client";

import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { EMPTY_PLAN, PlanForm } from "@/components/admin/memberships/PlanForm";

export default function NewMembershipPage() {
  const params = useParams() as { slug?: string };
  const slug = params?.slug ?? "";
  return (
    <div className="space-y-6">
      <PageHeader title="New membership plan" description="Set pricing, billing, guests, and visit allowance." />
      <PlanForm slug={slug} initial={EMPTY_PLAN} />
    </div>
  );
}
