import { DocumentsTab } from "@/components/admin/members/DocumentsTab";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return <DocumentsTab slug={slug} memberId={id} />;
}
