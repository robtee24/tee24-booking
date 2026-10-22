import { getCurrentMember, getMemberSession } from "@/lib/member-session";
import { PortalSubNav } from "@/components/portal/PortalSubNav";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";

export default async function PortalProfilePage() {
  const [member, session] = await Promise.all([getCurrentMember(), getMemberSession()]);
  if (!member) return null;
  const readOnly = session?.role === "IMPERSONATED";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-apple-2xl font-semibold tracking-tight">Profile</h1>
        <PortalSubNav />
      </div>
      {readOnly && <p className="rounded-apple-sm bg-apple-orange/10 px-4 py-2 text-apple-sm text-apple-orange">Editing is disabled while staff are viewing this account.</p>}
      <ProfileForm
        readOnly={readOnly}
        initial={{
          firstName: member.firstName,
          lastName: member.lastName,
          email: member.email,
          phone: member.phone,
          dob: member.dob ? member.dob.toISOString().slice(0, 10) : null,
          gender: member.gender,
          addressLine1: member.addressLine1,
          addressLine2: member.addressLine2,
          city: member.city,
          state: member.state,
          zip: member.zip,
          country: member.country,
          guardianName: member.guardianName,
        }}
      />
    </div>
  );
}
