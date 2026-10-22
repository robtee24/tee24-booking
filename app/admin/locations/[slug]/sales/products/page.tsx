// app/admin/locations/[slug]/sales/products/page.tsx
import { ProductsScreen } from "@/components/admin/sales/ProductsScreen";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ProductsScreen slug={decodeURIComponent(slug)} />;
}
