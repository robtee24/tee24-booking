import { redirect } from "next/navigation";

export default async function SchedulingBookingsRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/locations/${slug}/bookings`);
}
