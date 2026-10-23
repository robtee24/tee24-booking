import { getMemberSession } from "@/lib/member-session";
import { SwingHome } from "./SwingHome";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getMemberSession();
  const readOnly = session?.role === "IMPERSONATED";
  return <SwingHome readOnly={readOnly} />;
}
