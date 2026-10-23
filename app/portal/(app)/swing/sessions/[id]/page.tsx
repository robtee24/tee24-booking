import { getMemberSession } from "@/lib/member-session";
import { SessionDetail } from "./SessionDetail";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await getMemberSession();
  const readOnly = session?.role === "IMPERSONATED";
  const { id } = await params;
  return <SessionDetail readOnly={readOnly} id={id} />;
}
