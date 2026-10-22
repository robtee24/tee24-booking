import { MessagingTab } from "@/components/admin/members/MessagingTab";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return <MessagingTab slug={slug} memberId={id} />;
}
