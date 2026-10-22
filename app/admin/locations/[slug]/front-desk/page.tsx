import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { FrontDeskKiosk } from "@/components/admin/members/FrontDeskKiosk";

export const dynamic = "force-dynamic";

export default async function FrontDeskPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const location = await getPrisma().location.findUnique({ where: { slug }, select: { name: true, attendanceDedupeHours: true } });
  if (!location) notFound();
  return <FrontDeskKiosk slug={slug} locationName={location.name} dedupeHours={location.attendanceDedupeHours} />;
}
