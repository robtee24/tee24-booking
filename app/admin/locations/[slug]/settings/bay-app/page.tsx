import { redirect } from "next/navigation";

export default async function BayAppRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/locations/${slug}#bay-app`);
}
