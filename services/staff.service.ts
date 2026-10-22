// services/staff.service.ts
//
// Staff roster: admin CRUD, permission matrix persistence, invites and the
// front-desk PIN. Everything that writes goes through `audit()`.
import crypto from "crypto";
import type { AdminRole } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { toE164 } from "@/lib/phone";
import { sendQuoSms } from "@/lib/quo";
import { sendEmail } from "@/lib/notify";
import { adminRoutes } from "@/lib/admin/routes";

/* ───────────────────────────── Permission catalog ─────────────────────────── */

export type PermissionGroup = { key: string; label: string; permissions: Permission[] };

const GROUP_LABELS: Record<string, string> = {
  member: "Members",
  membership: "Memberships",
  billing: "Billing",
  document: "Documents",
  discount: "Discounts",
  attendance: "Attendance",
  marketing: "Marketing",
  admin: "Admins & settings",
  scheduling: "Scheduling",
  ops: "Operations",
  kisi: "Door access",
  franchise: "Franchise",
};

/** PERMISSIONS grouped by their `{module}.` prefix, in catalog order. */
export function permissionGroups(): PermissionGroup[] {
  const groups = new Map<string, PermissionGroup>();
  for (const key of Object.keys(PERMISSIONS) as Permission[]) {
    const mod = key.split(".")[0];
    if (!groups.has(mod)) groups.set(mod, { key: mod, label: GROUP_LABELS[mod] ?? mod, permissions: [] });
    groups.get(mod)!.permissions.push(key);
  }
  return [...groups.values()];
}

export const PERMISSION_PRESETS: Record<string, { label: string; description: string; permissions: Permission[] }> = {
  manager: {
    label: "Manager",
    description: "Runs the location day to day: members, billing, documents, scheduling, tasks.",
    permissions: [
      "member.view", "member.edit", "member.view-internal-notes", "member.view-churn-risk", "member.bulk-message", "member.export",
      "membership.subscribe", "membership.cancel", "membership.freeze", "membership.comp", "membership.waive-fee",
      "billing.view", "billing.charge", "billing.refund", "billing.edit-invoice", "billing.change-payment-method", "billing.add-credit",
      "document.view-library", "document.assign", "document.view-signed",
      "discount.apply",
      "attendance.view", "attendance.edit", "attendance.add-manual",
      "marketing.view-dashboard", "marketing.send-bulk", "marketing.view-visitors",
      "scheduling.edit-bay", "scheduling.edit-bookings", "scheduling.edit-notifications",
      "ops.checklists", "ops.maintenance", "ops.tasks",
      "kisi.override",
    ],
  },
  "front-desk": {
    label: "Front desk",
    description: "Check-ins, bookings, member lookups, taking payments, assigning waivers.",
    permissions: [
      "member.view", "member.edit",
      "membership.subscribe",
      "billing.view", "billing.charge", "billing.change-payment-method",
      "document.view-library", "document.assign", "document.view-signed",
      "discount.apply",
      "attendance.view", "attendance.add-manual",
      "marketing.view-visitors",
      "scheduling.edit-bookings",
      "ops.checklists", "ops.maintenance", "ops.tasks",
    ],
  },
  instructor: {
    label: "Instructor",
    description: "Sees members and attendance, can check people in and log tasks.",
    permissions: ["member.view", "attendance.view", "attendance.add-manual", "scheduling.edit-bookings", "ops.tasks"],
  },
};

function isPermission(p: string): p is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, p);
}

/* ───────────────────────────── Front-desk PIN ─────────────────────────────── */

const PIN_RE = /^\d{4,6}$/;

export function isValidPin(pin: string): boolean {
  return PIN_RE.test(pin);
}

/** scrypt hash → "scrypt$<saltB64>$<hashB64>" */
export function hashPin(pin: string): string {
  if (!isValidPin(pin)) throw new Error("PIN must be 4–6 digits");
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPinHash(pin: string, stored: string | null | undefined): boolean {
  if (!stored || !PIN_RE.test(pin)) return false;
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(pin, Buffer.from(saltB64, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function setAdminPin(adminId: string, pin: string, actorId: string) {
  if (!isValidPin(pin)) throw new StaffError("PIN must be 4–6 digits", 400);
  await getPrisma().admin.update({ where: { id: adminId }, data: { frontDeskPinHash: hashPin(pin) } });
  void audit({ actorId, action: "admin.update", entityType: "Admin", entityId: adminId, metadata: { event: "pin.set" } });
}

export async function clearAdminPin(adminId: string, actorId: string) {
  await getPrisma().admin.update({ where: { id: adminId }, data: { frontDeskPinHash: null } });
  void audit({ actorId, action: "admin.update", entityType: "Admin", entityId: adminId, metadata: { event: "pin.cleared" } });
}

export async function verifyAdminPin(adminId: string, pin: string): Promise<boolean> {
  const row = await getPrisma().admin.findUnique({ where: { id: adminId }, select: { frontDeskPinHash: true } });
  return verifyPinHash(pin, row?.frontDeskPinHash);
}

/* ───────────────────────────── Roster CRUD ────────────────────────────────── */

export class StaffError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "StaffError";
  }
}

const ADMIN_SELECT = {
  id: true,
  phone: true,
  email: true,
  name: true,
  role: true,
  twoFactorEnabled: true,
  inviteStatus: true,
  invitedAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  frontDeskPinHash: true,
  locations: { include: { location: { select: { id: true, name: true, slug: true } } } },
  permissions: { select: { permission: true, locationId: true, grantedById: true, grantedAt: true } },
} as const;

export type StaffAdmin = Omit<
  NonNullable<Awaited<ReturnType<typeof fetchAdminRaw>>>,
  "frontDeskPinHash"
> & { hasPin: boolean };

async function fetchAdminRaw(id: string) {
  return getPrisma().admin.findUnique({ where: { id }, select: ADMIN_SELECT });
}

function shape<T extends { frontDeskPinHash: string | null }>(a: T): Omit<T, "frontDeskPinHash"> & { hasPin: boolean } {
  const { frontDeskPinHash, ...rest } = a;
  return { ...rest, hasPin: !!frontDeskPinHash };
}

export async function getStaffAdmin(id: string): Promise<StaffAdmin | null> {
  const a = await fetchAdminRaw(id);
  return a ? shape(a) : null;
}

export async function listStaffAdmins(opts: { locationIds?: string[] } = {}): Promise<StaffAdmin[]> {
  const where = opts.locationIds
    ? { locations: { some: { locationId: { in: opts.locationIds } } } }
    : {};
  const rows = await getPrisma().admin.findMany({ where, select: ADMIN_SELECT, orderBy: { createdAt: "desc" } });
  return rows.map(shape);
}

export function normalizeAdminPhone(input: string): string {
  try {
    return toE164(input);
  } catch {
    throw new StaffError("Invalid phone number", 400);
  }
}

export function normalizeEmail(input: unknown): string | null {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new StaffError("Invalid email address", 400);
  return s;
}

export type PermissionGrantInput = { permission: string; locationId?: string | null };

export type CreateAdminInput = {
  name?: string | null;
  phone: string;
  email?: string | null;
  role: AdminRole;
  locationIds?: string[];
  permissions?: PermissionGrantInput[];
  sendInvite?: boolean;
};

export async function createStaffAdmin(input: CreateAdminInput, actorId: string): Promise<StaffAdmin> {
  const prisma = getPrisma();
  const phone = normalizeAdminPhone(input.phone);
  const email = normalizeEmail(input.email);
  const name = String(input.name ?? "").trim() || null;

  if (await prisma.admin.findUnique({ where: { phone } })) throw new StaffError("An admin with that phone already exists", 409);
  if (email && (await prisma.admin.findUnique({ where: { email } }))) throw new StaffError("An admin with that email already exists", 409);

  const locationIds = await validateLocationIds(input.locationIds ?? []);

  const created = await prisma.admin.create({
    data: {
      phone,
      email,
      name,
      role: input.role,
      inviteStatus: "INVITED",
      invitedAt: new Date(),
      locations: input.role === "SCOPED" && locationIds.length ? { create: locationIds.map((locationId) => ({ locationId })) } : undefined,
    },
    select: { id: true },
  });

  if (input.role === "SCOPED" && input.permissions?.length) {
    await replacePermissions(created.id, input.permissions, actorId, locationIds);
  }

  void audit({
    actorId,
    action: "admin.create",
    entityType: "Admin",
    entityId: created.id,
    after: { phone, email, name, role: input.role, locationIds },
  });

  if (input.sendInvite !== false) {
    await sendStaffInvite(created.id, actorId).catch((e) => console.error("[staff] invite send failed", e));
  }

  return (await getStaffAdmin(created.id))!;
}

export type UpdateAdminInput = {
  name?: string | null;
  email?: string | null;
  phone?: string;
  role?: AdminRole;
  locationIds?: string[];
  permissions?: PermissionGrantInput[];
};

export async function updateStaffAdmin(id: string, input: UpdateAdminInput, actorId: string): Promise<StaffAdmin> {
  const prisma = getPrisma();
  const before = await prisma.admin.findUnique({
    where: { id },
    select: { id: true, phone: true, email: true, name: true, role: true, locations: { select: { locationId: true } } },
  });
  if (!before) throw new StaffError("Admin not found", 404);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = String(input.name ?? "").trim() || null;
  if (input.email !== undefined) {
    const email = normalizeEmail(input.email);
    if (email && email !== before.email) {
      const dup = await prisma.admin.findUnique({ where: { email } });
      if (dup && dup.id !== id) throw new StaffError("An admin with that email already exists", 409);
    }
    data.email = email;
  }
  if (input.phone !== undefined) {
    const phone = normalizeAdminPhone(input.phone);
    if (phone !== before.phone) {
      const dup = await prisma.admin.findUnique({ where: { phone } });
      if (dup && dup.id !== id) throw new StaffError("An admin with that phone already exists", 409);
    }
    data.phone = phone;
  }
  const role: AdminRole = input.role ?? before.role;
  if (input.role !== undefined) data.role = input.role;

  const locationIds =
    input.locationIds !== undefined ? await validateLocationIds(input.locationIds) : before.locations.map((l) => l.locationId);

  await prisma.$transaction(async (tx) => {
    await tx.admin.update({ where: { id }, data });
    if (input.locationIds !== undefined || input.role !== undefined) {
      await tx.adminLocation.deleteMany({ where: { adminId: id } });
      if (role === "SCOPED" && locationIds.length) {
        await tx.adminLocation.createMany({ data: locationIds.map((locationId) => ({ adminId: id, locationId })) });
      }
    }
  });

  if (role !== "SCOPED") {
    // Org-wide roles have every permission implicitly; drop stale grants.
    await prisma.adminPermission.deleteMany({ where: { adminId: id } });
  } else if (input.permissions !== undefined) {
    await replacePermissions(id, input.permissions, actorId, locationIds);
  } else if (input.locationIds !== undefined) {
    // Location list changed: drop grants that point at locations no longer assigned.
    await prisma.adminPermission.deleteMany({ where: { adminId: id, locationId: { not: null, notIn: locationIds } } });
  }

  void audit({
    actorId,
    action: "admin.update",
    entityType: "Admin",
    entityId: id,
    before: { name: before.name, email: before.email, phone: before.phone, role: before.role, locationIds: before.locations.map((l) => l.locationId) },
    after: { ...data, role, locationIds },
  });

  return (await getStaffAdmin(id))!;
}

export async function deleteStaffAdmin(id: string, actorId: string) {
  const prisma = getPrisma();
  const existing = await prisma.admin.findUnique({ where: { id }, select: { phone: true, role: true, name: true } });
  if (!existing) throw new StaffError("Admin not found", 404);
  await prisma.$transaction(async (tx) => {
    await tx.adminPermission.deleteMany({ where: { adminId: id } });
    await tx.adminLocation.deleteMany({ where: { adminId: id } });
    await tx.task.updateMany({ where: { assignedToId: id }, data: { assignedToId: null } });
    await tx.admin.delete({ where: { id } });
  });
  void audit({ actorId, action: "admin.delete", entityType: "Admin", entityId: id, before: existing });
}

async function validateLocationIds(ids: string[]): Promise<string[]> {
  const unique = Array.from(new Set(ids.map(String).filter(Boolean)));
  if (!unique.length) return [];
  const found = await getPrisma().location.findMany({ where: { id: { in: unique } }, select: { id: true } });
  const ok = new Set(found.map((l) => l.id));
  const missing = unique.filter((id) => !ok.has(id));
  if (missing.length) throw new StaffError(`Unknown location id(s): ${missing.join(", ")}`, 400);
  return unique;
}

/**
 * Replace the full AdminPermission set for an admin. Grants with a
 * `locationId` must point at an assigned location; `null` = all assigned
 * locations (org-wide for that admin).
 */
export async function replacePermissions(
  adminId: string,
  grants: PermissionGrantInput[],
  actorId: string,
  allowedLocationIds?: string[],
) {
  const prisma = getPrisma();
  const allowed = allowedLocationIds
    ? new Set(allowedLocationIds)
    : new Set((await prisma.adminLocation.findMany({ where: { adminId }, select: { locationId: true } })).map((l) => l.locationId));

  const seen = new Set<string>();
  const clean: { permission: Permission; locationId: string | null }[] = [];
  for (const g of grants) {
    if (!g || !isPermission(g.permission)) continue;
    const locationId = g.locationId ? String(g.locationId) : null;
    if (locationId && !allowed.has(locationId)) continue;
    const k = `${g.permission}|${locationId ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    clean.push({ permission: g.permission, locationId });
  }

  const before = await prisma.adminPermission.findMany({ where: { adminId }, select: { permission: true, locationId: true } });

  await prisma.$transaction(async (tx) => {
    await tx.adminPermission.deleteMany({ where: { adminId } });
    if (clean.length) {
      await tx.adminPermission.createMany({
        data: clean.map((c) => ({ adminId, permission: c.permission, locationId: c.locationId, grantedById: actorId })),
      });
    }
  });

  const beforeKeys = new Set(before.map((b) => `${b.permission}|${b.locationId ?? ""}`));
  const afterKeys = new Set(clean.map((c) => `${c.permission}|${c.locationId ?? ""}`));
  const granted = [...afterKeys].filter((k) => !beforeKeys.has(k));
  const revoked = [...beforeKeys].filter((k) => !afterKeys.has(k));
  if (granted.length) {
    void audit({ actorId, action: "admin.permission-grant", entityType: "Admin", entityId: adminId, after: { granted } });
  }
  if (revoked.length) {
    void audit({ actorId, action: "admin.permission-revoke", entityType: "Admin", entityId: adminId, before: { revoked } });
  }
  return clean;
}

/* ───────────────────────────── Invites ────────────────────────────────────── */

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Send (or resend) the staff invite: SMS always (phone is the login
 * credential) and email when present. Marks the row INVITED/invitedAt.
 * Set `STAFF_INVITE_DRY_RUN=1` to log instead of sending.
 */
export async function sendStaffInvite(adminId: string, actorId: string): Promise<{ sms: boolean; email: boolean; dryRun: boolean }> {
  const prisma = getPrisma();
  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { id: true, name: true, phone: true, email: true, inviteStatus: true },
  });
  if (!admin) throw new StaffError("Admin not found", 404);

  const loginUrl = `${appBaseUrl()}${adminRoutes.login()}`;
  const first = (admin.name ?? "").split(/\s+/)[0] || "there";
  const smsText = `Hi ${first}, you've been added to Tee24 Admin. Sign in with this phone number at ${loginUrl}`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',Helvetica,sans-serif;padding:24px;color:#0f172a;max-width:560px;margin:auto;">
  <h1 style="font-size:20px;margin:0 0 16px;">You're invited to Tee24 Admin</h1>
  <p style="margin:0 0 16px;color:#475569;">Hi ${escapeHtml(first)}, an account has been created for you. Sign in with your phone number <strong>${escapeHtml(admin.phone)}</strong> — we'll text you a one-time code.</p>
  <a href="${loginUrl}" style="display:inline-block;background:#0071e3;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;">Open Tee24 Admin</a>
  <p style="margin-top:16px;font-size:12px;color:#94a3b8;">If the button doesn't work, copy this link: ${loginUrl}</p>
</div>`;

  const dryRun = process.env.STAFF_INVITE_DRY_RUN === "1";
  let sms = false;
  let email = false;
  if (dryRun) {
    console.log("[staff] DRY RUN invite", { to: admin.phone, email: admin.email, loginUrl });
    sms = true;
    email = !!admin.email;
  } else {
    const r = await sendQuoSms({ to: admin.phone, text: smsText, category: "SYSTEM" }).catch(() => ({ ok: false }));
    sms = !!r.ok;
    if (admin.email) {
      await sendEmail({ to: admin.email, subject: "You're invited to Tee24 Admin", html })
        .then(() => (email = true))
        .catch(() => (email = false));
    }
  }

  await prisma.admin.update({
    where: { id: adminId },
    data: { invitedAt: new Date(), ...(admin.inviteStatus === "ACTIVE" ? {} : { inviteStatus: "INVITED" }) },
  });
  void audit({ actorId, action: "admin.update", entityType: "Admin", entityId: adminId, metadata: { event: "invite.sent", sms, email, dryRun } });
  return { sms, email, dryRun };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
