// app/admin/locations/[slug]/sales/products/[id]/page.tsx
import { ProductForm } from "@/components/admin/sales/ProductForm";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return <ProductForm slug={decodeURIComponent(slug)} productId={decodeURIComponent(id)} />;
}
