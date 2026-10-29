// PUT /api/mobile/push — the app reports its push state after launch / when
// permission changes: { token?, permission, enabled, platform? }.
//
// `enabled` is true only when the OS permission is granted AND a token was
// obtained; the backend uses this to decide push vs SMS for the member.
import { getPrisma } from "@/lib/db";
import { isExpoPushToken } from "@/lib/expo-push";
import { MobileError } from "@/services/mobile-auth.service";
import { ok, readJson, withMobileAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { token?: string | null; permission?: string | null; enabled?: boolean; platform?: string | null };

export const PUT = withMobileAuth("push", async (req, auth) => {
  const body = await readJson<Body>(req);
  const token = body.token?.trim() || null;
  if (token && !isExpoPushToken(token)) throw new MobileError("Invalid push token", 400, "INVALID_TOKEN");
  const permission = typeof body.permission === "string" ? body.permission.slice(0, 32) : null;
  const enabled = !!body.enabled && !!token;

  const prisma = getPrisma();
  // A token belongs to one install — if it moved to another member/device row, clear it there.
  if (token) {
    await prisma.memberDevice.updateMany({
      where: { pushToken: token, id: { not: auth.deviceRowId } },
      data: { pushToken: null, pushEnabled: false, pushUpdatedAt: new Date() },
    });
  }
  const device = await prisma.memberDevice.update({
    where: { id: auth.deviceRowId },
    data: {
      pushToken: token,
      pushEnabled: enabled,
      pushPermission: permission,
      pushUpdatedAt: new Date(),
      ...(body.platform ? { platform: body.platform === "android" ? "android" : "ios" } : {}),
      lastSeenAt: new Date(),
    },
    select: { pushEnabled: true, pushPermission: true, pushUpdatedAt: true },
  });
  return ok({ push: { enabled: device.pushEnabled, permission: device.pushPermission, updatedAt: device.pushUpdatedAt?.toISOString() ?? null } });
});

/** GET /api/mobile/push — current state for this device. */
export const GET = withMobileAuth("push", async (_req, auth) => {
  const d = await getPrisma().memberDevice.findUnique({ where: { id: auth.deviceRowId }, select: { pushEnabled: true, pushPermission: true, pushUpdatedAt: true } });
  return ok({ push: { enabled: d?.pushEnabled ?? false, permission: d?.pushPermission ?? null, updatedAt: d?.pushUpdatedAt?.toISOString() ?? null } });
});
