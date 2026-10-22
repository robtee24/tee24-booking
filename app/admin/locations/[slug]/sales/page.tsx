// app/admin/locations/[slug]/sales/page.tsx
import { NewSaleScreen } from "@/components/admin/sales/NewSaleScreen";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <NewSaleScreen slug={decodeURIComponent(slug)} />;
}
