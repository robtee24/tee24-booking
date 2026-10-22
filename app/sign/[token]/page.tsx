// /sign/[token] — PUBLIC document signing page.
// This is the URL document.service puts in SMS/email links. It must work
// for members who are not logged in to the portal (the token is the
// credential), which is why it lives outside app/portal (whose layout
// redirects anonymous visitors to /portal/login).
import type { Metadata } from "next";
import Link from "next/link";
import { getMemberSession } from "@/lib/member-session";
import { loadSigningView } from "@/services/portal.service";
import { SignDocumentView } from "@/components/portal/SignDocumentView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign document · Tee24", robots: { index: false, follow: false } };

export default async function PublicSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const [view, session] = await Promise.all([loadSigningView(token, { markViewed: true }), getMemberSession().catch(() => null)]);
  const loggedIn = !!session?.sub;

  return (
    <div className="min-h-screen bg-apple-bg">
      <header className="border-b border-apple-divider bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href={loggedIn ? "/portal" : "/"} className="text-apple-lg font-semibold tracking-tight text-apple-text">
            {view.locationName ?? "Tee24"}
          </Link>
          {loggedIn ? (
            <Link href="/portal/documents" className="text-apple-sm text-apple-text-secondary hover:text-apple-text">My documents</Link>
          ) : (
            <Link href="/portal/login" className="text-apple-sm text-apple-text-secondary hover:text-apple-text">Member sign in</Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <SignDocumentView
          token={token}
          view={{ ...view, signedAt: view.signedAt?.toISOString() ?? null, expiresAt: view.expiresAt?.toISOString() ?? null }}
          backHref={loggedIn ? "/portal/documents" : "/portal/login"}
          backLabel={loggedIn ? "Back to my documents" : "Go to the member portal"}
          loggedIn={loggedIn}
        />
      </main>
    </div>
  );
}
