/**
 * Member app sign-in: phone OTP → device binding → 90-day session.
 *
 * Device policy: one active phone per member. When a verified number tries to
 * sign in from a different phone we refuse and let the member file a
 * DeviceTransferRequest; staff approve it from Admin → Mobile App (or the
 * member profile), which revokes the old device + sessions and binds the new one.
 */
import { getPrisma } from "@/lib/db";
import { adminNotify } from "@/lib/admin-notify";
import { adminRoutes } from "@/lib/admin/routes";
import { audit } from "@/lib/audit";
import { issueMobileSession, revokeDeviceSessions } from "@/lib/mobile-session";

export class MobileError extends Error {
  constructor(message: string, public status = 400, public code = "BAD_REQUEST", public extra?: Record<string, unknown>) {
    super(message);
    this.name = "MobileError";
  }
}

export type DeviceInfo = {
  deviceId: string;
  platform?: string;
  name?: string | null;
  model?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
};

const STATUS_RANK: Record<string, number> = { ACTIVE: 0, FROZEN: 1, PENDING: 2, CANCEL_SCHEDULED: 2, VISITOR: 3, CANCELLED: 4 };

/** Pick the member record a phone number refers to (active first). */
export async function findMemberByPhone(e164: string) {
  const digits = e164.replace(/\D/g, "").slice(-10);
  const members = await getPrisma().member.findMany({
    where: { phone: { contains: digits }, mergedIntoId: null },
    select: { id: true, status: true, updatedAt: true, firstName: true, lastName: true, locationId: true, organizationId: true, location: { select: { slug: true, name: true } } },
  });
  if (!members.length) return null;
  members.sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || b.updatedAt.getTime() - a.updatedAt.getTime());
  return members[0]!;
}

export function cleanDevice(raw: Record<string, unknown>): DeviceInfo {
  const s = (v: unknown, max = 120) => {
    const t = String(v ?? "").trim();
    return t ? t.slice(0, max) : null;
  };
  const deviceId = s(raw.deviceId, 128);
  if (!deviceId || deviceId.length < 8) throw new MobileError("Device identifier missing", 400, "DEVICE_ID_REQUIRED");
  const platform = s(raw.platform, 16)?.toLowerCase();
  return {
    deviceId,
    platform: platform === "android" ? "android" : "ios",
    name: s(raw.deviceName ?? raw.name),
    model: s(raw.deviceModel ?? raw.model),
    osVersion: s(raw.osVersion, 40),
    appVersion: s(raw.appVersion, 40),
  };
}

export async function getActiveDevice(memberId: string) {
  return getPrisma().memberDevice.findFirst({ where: { memberId, revokedAt: null }, orderBy: { boundAt: "desc" } });
}

export type CompleteSignInResult =
  | { ok: true; token: string; expiresAt: Date; memberId: string; bound: "existing" | "new" }
  | { ok: false; code: "DEVICE_MISMATCH"; memberId: string; boundDevice: { name: string | null; model: string | null; boundAt: Date }; pendingRequestId: string | null };

/**
 * After the OTP check passed for `memberId`: bind/verify the device and issue
 * a session, or report a mismatch so the app can offer a transfer request.
 */
export async function completeSignIn(memberId: string, device: DeviceInfo, ip?: string | null): Promise<CompleteSignInResult> {
  const prisma = getPrisma();
  const active = await getActiveDevice(memberId);

  if (active && active.deviceId !== device.deviceId) {
    const pending = await prisma.deviceTransferRequest.findFirst({
      where: { memberId, toDeviceId: device.deviceId, status: "PENDING" },
      select: { id: true },
    });
    return {
      ok: false,
      code: "DEVICE_MISMATCH",
      memberId,
      boundDevice: { name: active.name, model: active.model, boundAt: active.boundAt },
      pendingRequestId: pending?.id ?? null,
    };
  }

  const meta = { platform: device.platform ?? "ios", name: device.name, model: device.model, osVersion: device.osVersion, appVersion: device.appVersion, lastSeenAt: new Date() };
  let row = active;
  let bound: "existing" | "new" = "existing";
  if (row) {
    row = await prisma.memberDevice.update({ where: { id: row.id }, data: meta });
  } else {
    // Re-use a previously revoked row for the same hardware if it exists (unique memberId+deviceId)
    row = await prisma.memberDevice.upsert({
      where: { memberId_deviceId: { memberId, deviceId: device.deviceId } },
      update: { ...meta, revokedAt: null, revokedById: null, revokedReason: null, boundAt: new Date() },
      create: { memberId, deviceId: device.deviceId, ...meta },
    });
    bound = "new";
    void audit({ actorId: memberId, actorRole: "MEMBER", action: "device.bind", entityType: "MemberDevice", entityId: row.id, after: { deviceId: device.deviceId, model: device.model }, metadata: { via: "mobile" } });
  }

  const session = await issueMobileSession({ memberId, deviceRowId: row.id, ip });
  return { ok: true, token: session.token, expiresAt: session.expiresAt, memberId, bound };
}

/** Member asks to move their account to this phone. Idempotent per (member, device). */
export async function requestDeviceTransfer(memberId: string, device: DeviceInfo, note?: string | null) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, locationId: true, organizationId: true, location: { select: { slug: true, name: true } } },
  });
  if (!member) throw new MobileError("Member not found", 404, "MEMBER_NOT_FOUND");
  const active = await getActiveDevice(memberId);
  if (!active) throw new MobileError("No device is linked to this account yet — just sign in.", 409, "NO_DEVICE_BOUND");
  if (active.deviceId === device.deviceId) throw new MobileError("This phone is already linked to your account.", 409, "ALREADY_BOUND");

  const existing = await prisma.deviceTransferRequest.findFirst({ where: { memberId, toDeviceId: device.deviceId, status: "PENDING" } });
  if (existing) return { request: existing, created: false };

  const request = await prisma.deviceTransferRequest.create({
    data: {
      memberId,
      fromDeviceId: active.id,
      toDeviceId: device.deviceId,
      toDeviceName: device.name,
      toDeviceModel: device.model,
      toPlatform: device.platform ?? "ios",
      memberNote: note?.trim().slice(0, 500) || null,
    },
  });

  const name = `${member.firstName} ${member.lastName}`.trim();
  const title = `New phone request · ${name}`;
  const body = `${name} is signing in from ${device.model ?? "a new phone"}${device.name ? ` (“${device.name}”)` : ""} and asked to move their account from ${active.model ?? "their current phone"}.`;
  const link = `${adminRoutes.mobileApp()}?request=${request.id}`;

  const task = await prisma.task.create({
    data: {
      organizationId: member.organizationId,
      locationId: member.locationId,
      memberId: member.id,
      title,
      body: `${body}\nApprove or deny from Admin → Mobile App.\nPhone ${member.phone} · ${member.email}`,
      priority: "HIGH",
      dueAt: new Date(Date.now() + 86_400_000),
      status: "OPEN",
    },
  });
  await adminNotify({
    organizationId: member.organizationId ?? undefined,
    locationId: member.locationId,
    kind: "device.transfer_requested",
    severity: "WARN",
    title,
    body,
    link,
    data: { memberId: member.id, requestId: request.id, taskId: task.id, toDeviceModel: device.model, toDeviceName: device.name },
  });

  return { request, created: true };
}

/** Admin approves: revoke old device + sessions, bind the new one. */
export async function approveDeviceTransfer(requestId: string, adminId: string, note?: string | null) {
  const prisma = getPrisma();
  const request = await prisma.deviceTransferRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new MobileError("Request not found", 404, "NOT_FOUND");
  if (request.status !== "PENDING") throw new MobileError(`Request already ${request.status.toLowerCase()}`, 409, "NOT_PENDING");

  await unlockMemberDevice(request.memberId, adminId, "transfer_approved");

  await prisma.memberDevice.upsert({
    where: { memberId_deviceId: { memberId: request.memberId, deviceId: request.toDeviceId } },
    update: { revokedAt: null, revokedById: null, revokedReason: null, boundAt: new Date(), name: request.toDeviceName, model: request.toDeviceModel, platform: request.toPlatform },
    create: { memberId: request.memberId, deviceId: request.toDeviceId, name: request.toDeviceName, model: request.toDeviceModel, platform: request.toPlatform },
  });

  const updated = await prisma.deviceTransferRequest.update({
    where: { id: requestId },
    data: { status: "APPROVED", resolvedById: adminId, resolvedAt: new Date(), resolutionNote: note?.trim().slice(0, 500) || null },
  });
  // Deny any other pending requests from different phones for this member
  await prisma.deviceTransferRequest.updateMany({
    where: { memberId: request.memberId, status: "PENDING", id: { not: requestId } },
    data: { status: "CANCELLED", resolvedAt: new Date(), resolvedById: adminId, resolutionNote: "Superseded by another approved transfer" },
  });
  await closeTransferTasks(request.memberId, requestId);
  void audit({ actorId: adminId, actorRole: "ADMIN", action: "device.transfer-approve", entityType: "DeviceTransferRequest", entityId: requestId, after: { status: "APPROVED" }, metadata: { memberId: request.memberId } });
  return updated;
}

export async function denyDeviceTransfer(requestId: string, adminId: string, note?: string | null) {
  const prisma = getPrisma();
  const request = await prisma.deviceTransferRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new MobileError("Request not found", 404, "NOT_FOUND");
  if (request.status !== "PENDING") throw new MobileError(`Request already ${request.status.toLowerCase()}`, 409, "NOT_PENDING");
  const updated = await prisma.deviceTransferRequest.update({
    where: { id: requestId },
    data: { status: "DENIED", resolvedById: adminId, resolvedAt: new Date(), resolutionNote: note?.trim().slice(0, 500) || null },
  });
  await closeTransferTasks(request.memberId, requestId);
  void audit({ actorId: adminId, actorRole: "ADMIN", action: "device.transfer-deny", entityType: "DeviceTransferRequest", entityId: requestId, after: { status: "DENIED" }, metadata: { memberId: request.memberId } });
  return updated;
}

/**
 * Admin "unlock device": revoke the member's active device and all its
 * sessions so they can sign in on a new phone (lost / replaced phone).
 */
export async function unlockMemberDevice(memberId: string, adminId: string | null, reason: "admin_unlock" | "transfer_approved" | "member_signout" = "admin_unlock") {
  const prisma = getPrisma();
  const devices = await prisma.memberDevice.findMany({ where: { memberId, revokedAt: null } });
  for (const d of devices) {
    await prisma.memberDevice.update({ where: { id: d.id }, data: { revokedAt: new Date(), revokedById: adminId, revokedReason: reason } });
    await revokeDeviceSessions(d.id);
  }
  if (reason === "admin_unlock") {
    // Pending transfer requests are moot once the device is unlocked.
    await prisma.deviceTransferRequest.updateMany({
      where: { memberId, status: "PENDING" },
      data: { status: "CANCELLED", resolvedAt: new Date(), resolvedById: adminId, resolutionNote: "Device unlocked by staff — member can sign in on the new phone" },
    });
    await closeTransferTasks(memberId);
    if (adminId) void audit({ actorId: adminId, actorRole: "ADMIN", action: "device.unlock", entityType: "Member", entityId: memberId, after: { devicesRevoked: devices.length } });
  }
  return { revoked: devices.length };
}

async function closeTransferTasks(memberId: string, requestId?: string) {
  const prisma = getPrisma();
  await prisma.task.updateMany({
    where: { memberId, status: { in: ["OPEN", "IN_PROGRESS"] }, title: { startsWith: "New phone request" } },
    data: { status: "DONE", completedAt: new Date() },
  }).catch(() => {});
  if (requestId) {
    await prisma.adminNotification.updateMany({
      where: { kind: "device.transfer_requested", readAt: null, data: { path: ["requestId"], equals: requestId } },
      data: { readAt: new Date() },
    }).catch(() => {});
  }
}

/** Read model for admin pages. */
export async function listTransferRequests(opts: { status?: string; locationIds?: string[]; limit?: number }) {
  return getPrisma().deviceTransferRequest.findMany({
    where: {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.locationIds ? { member: { locationId: { in: opts.locationIds } } } : {}),
    },
    include: { member: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, locationId: true, location: { select: { slug: true, name: true } } } } },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 100,
  });
}

export async function memberDeviceSummary(memberId: string) {
  const prisma = getPrisma();
  const [active, history, pending, sessions] = await Promise.all([
    getActiveDevice(memberId),
    prisma.memberDevice.findMany({ where: { memberId }, orderBy: { boundAt: "desc" }, take: 10 }),
    prisma.deviceTransferRequest.findMany({ where: { memberId, status: "PENDING" }, orderBy: { createdAt: "desc" } }),
    prisma.mobileSession.count({ where: { memberId, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return { active, history, pending, liveSessions: sessions };
}
