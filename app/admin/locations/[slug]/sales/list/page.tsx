// app/admin/locations/[slug]/sales/list/page.tsx
import { SalesListScreen } from "@/components/admin/sales/SalesListScreen";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <SalesListScreen slug={decodeURIComponent(slug)} />;
}
