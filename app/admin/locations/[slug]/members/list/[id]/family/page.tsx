import { FamilyTab } from "@/components/admin/members/FamilyTab";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return <FamilyTab slug={slug} memberId={id} />;
}
