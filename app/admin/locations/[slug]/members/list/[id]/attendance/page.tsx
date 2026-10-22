import { AttendanceTab } from "@/components/admin/members/AttendanceTab";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return <AttendanceTab slug={slug} memberId={id} />;
}
