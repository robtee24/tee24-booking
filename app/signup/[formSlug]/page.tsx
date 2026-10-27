import { SignupPage, type SignupSearchParams } from "./SignupPage";

export const dynamic = "force-dynamic";

export default async function PublicSignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ formSlug: string }>;
  searchParams: Promise<SignupSearchParams>;
}) {
  const { formSlug } = await params;
  const sp = await searchParams;
  return <SignupPage formSlug={formSlug} sp={sp} />;
}
