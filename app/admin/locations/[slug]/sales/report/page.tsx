// app/admin/locations/[slug]/sales/report/page.tsx
import { ReportScreen } from "@/components/admin/sales/ReportScreen";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ReportScreen slug={decodeURIComponent(slug)} />;
}
