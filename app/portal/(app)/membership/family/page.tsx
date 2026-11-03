import { getCurrentMember, getMemberSession } from "@/lib/member-session";
import { getFamilyContext, serializeFamily } from "@/services/family-addon.service";
import { sanitizeDocHtml } from "@/services/portal.service";
import { PortalSubNav } from "@/components/portal/PortalSubNav";
import { FamilyClient } from "./FamilyClient";

export const dynamic = "force-dynamic";

export default async function PortalFamilyPage() {
  const [member, session] = await Promise.all([getCurrentMember(), getMemberSession()]);
  if (!member) return null;
  const view = serializeFamily(await getFamilyContext(member.id));
  if (view.available) view.documents = view.documents.map((d) => ({ ...d, bodyHtml: sanitizeDocHtml(d.bodyHtml ?? "") }));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-apple-2xl font-semibold tracking-tight">Family</h1>
        <PortalSubNav />
      </div>
      <FamilyClient
        initial={view}
        canEdit={session?.role !== "IMPERSONATED"}
        holderName={`${member.firstName} ${member.lastName}`.trim()}
        holderEmail={member.email}
        holderPhone={member.phone}
        locationName={member.location?.name ?? "Tee24"}
      />
    </div>
  );
}
