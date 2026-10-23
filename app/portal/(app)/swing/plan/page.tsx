import { getMemberSession } from "@/lib/member-session";
import { PlanClient } from "./PlanClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getMemberSession();
  const readOnly = session?.role === "IMPERSONATED";
  return <PlanClient readOnly={readOnly} />;
}
