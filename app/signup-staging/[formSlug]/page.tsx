import { SignupPage, type SignupSearchParams } from "@/app/signup/[formSlug]/SignupPage";

export const dynamic = "force-dynamic";

/**
 * Staging copy of the public signup form. Same renderer as /signup/<slug>, but it also
 * serves forms that are still unpublished in admin so they can be tested before launch.
 * Not linked from anywhere public and excluded from search indexing.
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function StagingSignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ formSlug: string }>;
  searchParams: Promise<SignupSearchParams>;
}) {
  const { formSlug } = await params;
  const sp = await searchParams;
  return <SignupPage formSlug={formSlug} sp={sp} staging />;
}
