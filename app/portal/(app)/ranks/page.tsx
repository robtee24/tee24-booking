// Ranks & streaks were a Phase-3 placeholder; send people home instead of a dead tab.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function PortalRanks() {
  redirect("/portal");
}
