import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember, getMemberSession } from "@/lib/member-session";
import { Eye, AlertOctagon, LogOut } from "lucide-react";
import { PortalNav } from "@/components/portal/PortalNav";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getMemberSession();
  const member = await getCurrentMember();

  if (!member) {
    redirect("/portal/login");
  }

  const isImpersonating = session?.role === "IMPERSONATED";
  const initials = `${member.firstName?.[0] ?? ""}${member.lastName?.[0] ?? ""}`.toUpperCase() || "T";

  return (
    <div className="min-h-screen bg-[#f3f7f4]">
      {isImpersonating && (
        <div className="flex items-center justify-center gap-3 bg-apple-red/10 px-4 py-2 text-center text-apple-sm font-medium text-apple-red">
          <span>
            <AlertOctagon className="mr-2 inline h-4 w-4" />
            Viewing as {member.firstName} {member.lastName}.
          </span>
          <form method="POST" action="/api/portal/impersonation/stop">
            <button type="submit" className="rounded-apple-pill border border-apple-red/30 bg-white px-3 py-1 text-apple-xs font-semibold text-apple-red hover:bg-apple-red/5">
              End impersonation
            </button>
          </form>
        </div>
      )}

      <header className="bg-[#0b3d2e] bg-[radial-gradient(ellipse_at_top_left,_rgba(34,197,94,0.35),_transparent_55%)] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 pb-3 pt-4">
          <Link href="/portal" className="flex items-center gap-3" aria-label="Tee24 clubhouse home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/tee24-logo.png" alt="Tee24 Indoor Golf Center" className="h-12 w-auto sm:h-14" />
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60 sm:block">
              {member.location?.name ?? "Clubhouse"}
            </span>
          </Link>
          <div className="flex items-center gap-2 text-apple-sm">
            <Link href="/portal/profile" className="flex items-center gap-2 rounded-apple-pill py-1 pl-1 pr-3 transition-colors hover:bg-white/10" title="Your profile">
              {member.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={member.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover ring-2 ring-white/40" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#22c55e] text-[12px] font-bold text-[#0b3d2e] ring-2 ring-white/30">{initials}</span>
              )}
              <span className="hidden font-medium sm:inline">{member.firstName}</span>
            </Link>
            <Link href="/portal/logout" className="flex items-center gap-1.5 rounded-apple-pill px-3 py-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white" title="Sign out">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Link>
          </div>
        </div>
        <PortalNav />
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-5xl px-4 pb-8 pt-4 text-center text-apple-xs text-apple-text-tertiary">
        Tee24 Indoor Golf Center · open 24/7 for members · <Link href="/portal/contact" className="hover:underline">Need a hand?</Link>
      </footer>

      {isImpersonating && (
        <div className="fixed bottom-3 right-3 flex items-center gap-2 rounded-apple-pill bg-apple-red/10 px-3 py-1.5 text-apple-xs text-apple-red shadow-apple">
          <Eye className="h-3.5 w-3.5" />
          Impersonation active
        </div>
      )}
    </div>
  );
}
