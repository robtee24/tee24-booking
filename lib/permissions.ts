/**
 * Permissions catalog + RBAC `can()` helper.
 *
 * Permissions are kebab-case strings: "{module}.{verb}".
 * Org-wide admins (ROOT/FULL) implicitly have every permission.
 * SCOPED admins receive permissions per-location via AdminPermission rows.
 *
 * Usage:
 *   import { can } from "@/lib/permissions";
 *   if (!(await can(actor, "billing.refund", { locationId }))) throw new Forbidden();
 */
import type { AdminRole } from "@prisma/client";

export const PERMISSIONS = {
  // Member
  "member.view": "View members",
  "member.edit": "Edit member profiles",
  "member.delete": "Delete member records",
  "member.impersonate": "View as / sign in as a member",
  "member.view-internal-notes": "View internal admin-only notes",
  "member.view-churn-risk": "View churn risk score",
  "member.bulk-message": "Send bulk messages to member segments",
  "member.bulk-action": "Bulk freeze/cancel/tag members",
  "member.export": "Export member CSVs",

  // Membership
  "membership.create": "Create new membership plans",
  "membership.edit": "Edit membership plans",
  "membership.archive": "Archive membership plans",
  "membership.subscribe": "Add a membership to a member",
  "membership.cancel": "Cancel a member's membership",
  "membership.cancel-immediate": "Cancel immediately (override end-of-period)",
  "membership.freeze": "Freeze a member's membership",
  "membership.freeze-immediate": "Freeze immediately (override end-of-period)",
  "membership.comp": "Issue comp / sponsored memberships",
  "membership.exceed-freeze-limit": "Exceed configured freeze limits",
  "membership.waive-fee": "Waive freeze fees / signup fees",

  // Billing
  "billing.view": "View billing data",
  "billing.charge": "Run a charge against a member's payment method",
  "billing.refund": "Issue refunds",
  "billing.write-off": "Write off / cancel invoices",
  "billing.edit-invoice": "Edit unpaid invoices",
  "billing.change-payment-method": "Change a member's payment method on file",
  "billing.add-credit": "Add account credit (member credit ledger)",
  "billing.configure": "Configure billing settings (dunning, late fees, freeze policy, taxes)",

  // Documents
  "document.view-library": "View documents library",
  "document.create": "Create / edit document templates",
  "document.assign": "Assign documents to members",
  "document.void": "Void signed documents",
  "document.delete": "Delete document records",
  "document.view-signed": "View members' signed documents",

  // Discounts
  "discount.create": "Create discounts",
  "discount.edit": "Edit discounts",
  "discount.apply": "Apply discounts to members or invoices",

  // Attendance
  "attendance.view": "View attendance data",
  "attendance.edit": "Edit / delete visit records",
  "attendance.add-manual": "Add manual visit entries",

  // Marketing
  "marketing.view-dashboard": "View marketing dashboard",
  "marketing.send-bulk": "Send bulk emails / SMS",
  "marketing.manage-templates": "Manage message templates",
  "marketing.manage-automations": "Build / edit automations",
  "marketing.manage-referrals": "Manage referral program & payouts",
  "marketing.send-payouts": "Send referral payouts",
  "marketing.view-visitors": "View visitors funnel",

  // Admins / Settings
  "admin.manage": "Manage admin roster & permissions",
  "admin.view-audit-log": "View audit log",
  "admin.configure-integrations": "Configure Square / Kisi / Quo / Resend / PayPal",
  "admin.health": "View / replay integration health",

  // Scheduling
  "scheduling.edit-bay": "Edit bays",
  "scheduling.edit-bookings": "Edit / cancel bookings",
  "scheduling.edit-notifications": "Edit booking notifications",

  // Operations
  "ops.checklists": "Run / manage checklists",
  "ops.maintenance": "Add / resolve maintenance log entries",
  "ops.tasks": "Manage staff tasks",

  // Kisi door overrides
  "kisi.override": "Manually override Kisi door access state for a member",

  // Franchise / org
  "franchise.view": "View franchise / org-level reports",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function isFullAccess(role: AdminRole | string | null | undefined): boolean {
  return role === "ROOT" || role === "FULL";
}

export type ActorContext = {
  id: string;
  role: AdminRole;
  // List of permission grants, populated upstream from AdminPermission rows
  permissionGrants?: Array<{ permission: string; locationId: string | null }>;
  locationIds?: string[];
};

export type CanContext = {
  locationId?: string | null;
  organizationId?: string | null;
};

/**
 * Evaluate whether the actor has the permission, optionally scoped to a location.
 * - ROOT / FULL bypass every check.
 * - SCOPED: needs an AdminPermission grant with matching permission AND
 *   (locationId === null  ||  locationId === ctx.locationId).
 *   Also needs to be linked to ctx.locationId via AdminLocation.
 */
export function can(actor: ActorContext | null, permission: Permission, ctx: CanContext = {}): boolean {
  if (!actor) return false;
  if (isFullAccess(actor.role)) return true;

  if (ctx.locationId && actor.locationIds && !actor.locationIds.includes(ctx.locationId)) {
    return false;
  }

  if (!actor.permissionGrants) return false;

  return actor.permissionGrants.some((g) => {
    if (g.permission !== permission) return false;
    if (g.locationId === null) return true;
    if (ctx.locationId && g.locationId === ctx.locationId) return true;
    return false;
  });
}

export class ForbiddenError extends Error {
  constructor(public permission: string, public ctx?: CanContext) {
    super(`Forbidden: missing permission "${permission}"`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(actor: ActorContext | null, permission: Permission, ctx: CanContext = {}): asserts actor {
  if (!can(actor, permission, ctx)) throw new ForbiddenError(permission, ctx);
}
