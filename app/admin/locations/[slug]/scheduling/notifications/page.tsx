import { redirect } from "next/navigation";

export default async function SchedulingNotificationsRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/locations/${slug}/notifications`);
}
