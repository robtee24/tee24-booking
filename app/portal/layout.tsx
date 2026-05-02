import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember, getMemberSession } from "@/lib/member-session";
import { Eye, AlertOctagon } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getMemberSession();
  const member = await getCurrentMember();

  if (!member) {
    redirect("/portal/login");
  }

  const isImpersonating = session?.role === "IMPERSONATED";
  const tabs = [
    { href: "/portal", label: "Profile" },
    { href: "/portal/billing", label: "Billing" },
    { href: "/portal/attendance", label: "Attendance" },
    { href: "/portal/schedule", label: "Schedule" },
    { href: "/portal/documents", label: "Documents" },
    { href: "/portal/contact", label: "Contact" },
    { href: "/portal/ranks", label: "Ranks" },
  ];

  return (
    <div className="min-h-screen bg-apple-bg">
      {isImpersonating && (
        <div className="bg-apple-red/10 px-4 py-2 text-center text-apple-sm font-medium text-apple-red">
          <AlertOctagon className="mr-2 inline h-4 w-4" />
          Viewing as {member.firstName} {member.lastName}.
          <Link href="/api/portal/impersonation/end" className="ml-3 underline">End impersonation</Link>
        </div>
      )}

      <header className="border-b border-apple-divider bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/portal" className="text-apple-lg font-semibold tracking-tight text-apple-text">
            {member.location?.name ?? "Tee24"}
          </Link>
          <div className="flex items-center gap-3 text-apple-sm">
            <span className="text-apple-text-secondary">Hi, {member.firstName}</span>
            <Link href="/portal/logout" className="text-apple-text-secondary hover:text-apple-text">Sign out</Link>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-4">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="whitespace-nowrap px-3 py-2.5 text-apple-sm font-medium text-apple-text-secondary transition-colors hover:text-apple-text"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>

      {isImpersonating && (
        <div className="fixed bottom-3 right-3 flex items-center gap-2 rounded-apple-pill bg-apple-red/10 px-3 py-1.5 text-apple-xs text-apple-red shadow-apple">
          <Eye className="h-3.5 w-3.5" />
          Impersonation active
        </div>
      )}
    </div>
  );
}
