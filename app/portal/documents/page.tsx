import { Card, CardHeader, EmptyState, StatusBadge } from "@/components/ui";
import { getCurrentMember } from "@/lib/member-session";
import { getPrisma } from "@/lib/db";
import { FileText } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PortalDocuments() {
  const member = await getCurrentMember();
  if (!member) return null;
  const prisma = getPrisma();

  const assignments = await prisma.documentAssignment.findMany({
    where: { memberId: member.id },
    orderBy: { createdAt: "desc" },
    include: { document: true },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-apple-2xl font-semibold tracking-tight">Documents</h1>

      <Card>
        <CardHeader title="Your documents" subtitle="Waivers and forms — sign or download as PDF." />
        {assignments.length === 0 ? (
          <EmptyState icon={<FileText className="h-6 w-6" />} title="No documents yet" />
        ) : (
          <ul className="mt-3 divide-y divide-apple-divider">
            {assignments.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-apple-text">{a.document.name}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {a.signedAt ? `Signed ${new Date(a.signedAt).toLocaleDateString()}` : `Sent ${new Date(a.createdAt).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={a.status} size="sm" />
                  {a.status !== "SIGNED" && a.signingToken && (
                    <Link href={`/portal/documents/sign/${a.signingToken}`} className="text-apple-sm font-medium text-apple-blue hover:underline">
                      Sign →
                    </Link>
                  )}
                  {a.pdfUrl && a.status === "SIGNED" && (
                    <Link href={a.pdfUrl} className="text-apple-sm font-medium text-apple-blue hover:underline">
                      Download
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
