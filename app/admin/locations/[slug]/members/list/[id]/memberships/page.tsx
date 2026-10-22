import { MembershipsTab } from "@/components/admin/members/MembershipsTab";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return <MembershipsTab slug={slug} memberId={id} />;
}
