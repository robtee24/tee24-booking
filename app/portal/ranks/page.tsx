import { Card, CardHeader } from "@/components/ui";
import { Trophy } from "lucide-react";

export default async function PortalRanks() {
  return (
    <div className="space-y-6">
      <h1 className="text-apple-2xl font-semibold tracking-tight">Ranks & streaks</h1>
      <Card>
        <CardHeader title="Coming soon" subtitle="Streaks, attendance milestones, and gamification — Phase 3." />
        <div className="mt-4 flex items-center gap-3 text-apple-sm text-apple-text-secondary">
          <Trophy className="h-5 w-5 text-apple-orange" />
          Earn badges for visit streaks, anniversaries, and goals.
        </div>
      </Card>
    </div>
  );
}
