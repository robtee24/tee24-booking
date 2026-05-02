import { redirect } from "next/navigation";

export default async function MembersIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/locations/${slug}/members/list`);
}
