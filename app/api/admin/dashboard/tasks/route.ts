// GET /api/admin/dashboard/tasks?locationSlug=&window=today|7d|30d|all
// Open tasks for the dashboard widget (mine + unassigned at this location),
// filtered by the admin's client-side "tasks window" preference.
import { NextResponse, type NextRequest } from "next/server";
import { requireLocationAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan, ForbiddenError } from "@/lib/permissions";
import { getDashboardTasks, type TasksWindow } from "@/services/dashboard.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const locationSlug = (sp.get("locationSlug") ?? "").trim();
  if (!locationSlug) return NextResponse.json({ ok: false, error: "locationSlug required" }, { status: 400 });
  const guard = await requireLocationAdminApi({ locationSlug });
  if (!guard.ok) return guard.response;
  const location = guard.location!;
  try {
    assertCan(await getActorContext(), "ops.tasks", { locationId: location.id });
    const w = sp.get("window");
    const window: TasksWindow = w === "today" || w === "30d" || w === "all" ? w : "7d";
    const tasks = await getDashboardTasks({ locationId: location.id, adminId: guard.admin.id, window, limit: 10 });
    return NextResponse.json({ ok: true, window, tasks });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    console.error("[dashboard/tasks]", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
