import { NotesTab } from "@/components/admin/members/NotesTab";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return <NotesTab slug={slug} memberId={id} />;
}
