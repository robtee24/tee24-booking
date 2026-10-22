import { PaymentsTab } from "@/components/admin/members/PaymentsTab";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return <PaymentsTab slug={slug} memberId={id} />;
}
