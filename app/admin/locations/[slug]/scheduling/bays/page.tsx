import { redirect } from "next/navigation";

export default async function SchedulingBaysRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/locations/${slug}/bays`);
}
