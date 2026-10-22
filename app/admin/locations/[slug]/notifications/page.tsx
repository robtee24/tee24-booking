import { redirect } from "next/navigation";

/** Legacy path — canonical page lives under /scheduling. */
export default async function LegacyRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/locations/${slug}/scheduling/notifications`);
}
