// app/admin/locations/[slug]/sales/gift-cards/page.tsx
import { GiftCardsScreen } from "@/components/admin/sales/GiftCardsScreen";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <GiftCardsScreen slug={decodeURIComponent(slug)} />;
}
