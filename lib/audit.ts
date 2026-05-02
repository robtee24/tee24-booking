/**
 * Audit log writer.
 *
 * Use everywhere a write happens — billing, membership state, document signing,
 * Kisi overrides, impersonation, configuration changes, etc.
 *
 * Failures here MUST NOT block the underlying business operation. We swallow and log.
 */
import { getPrisma } from "@/lib/db";

export type AuditAction =
  // Member
  | "member.create" | "member.update" | "member.delete"
  | "member.status-change" | "member.tag-add" | "member.tag-remove"
  | "member.impersonate-start" | "member.impersonate-end"
  // Membership
  | "membership.create" | "membership.cancel-schedule" | "membership.cancel-immediate"
  | "membership.cancel-undo" | "membership.reactivate"
  | "membership.freeze" | "membership.freeze-immediate"
  | "membership.unfreeze" | "membership.extend"
  | "membership.plan-change"
  // Billing
  | "billing.charge" | "billing.refund" | "billing.write-off"
  | "billing.invoice-edit" | "billing.invoice-cancel"
  | "billing.payment-method-add" | "billing.payment-method-remove" | "billing.payment-method-default"
  | "billing.credit-add" | "billing.credit-spend"
  | "billing.discount-apply"
  // Documents
  | "document.create" | "document.assign" | "document.sign" | "document.void"
  | "document.resend" | "document.delete"
  // Kisi
  | "kisi.access-enable" | "kisi.access-disable" | "kisi.access-override"
  // Marketing
  | "automation.enroll" | "automation.exit" | "automation.pause"
  | "message.send" | "message.bulk-send"
  | "referral.payout-create" | "referral.payout-send"
  // Admin
  | "admin.create" | "admin.update" | "admin.delete"
  | "admin.permission-grant" | "admin.permission-revoke"
  | "admin.login" | "admin.logout"
  // Settings
  | "settings.update";

export type AuditEntry = {
  organizationId?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: any;
  after?: any;
  metadata?: any;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await getPrisma().auditLog.create({
      data: {
        organizationId: entry.organizationId ?? undefined,
        actorId: entry.actorId ?? undefined,
        actorRole: entry.actorRole ?? undefined,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before ?? undefined,
        after: entry.after ?? undefined,
        metadata: entry.metadata ?? undefined,
        ipAddress: entry.ipAddress ?? undefined,
        userAgent: entry.userAgent ?? undefined,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write entry", entry.action, err);
  }
}

/**
 * Convenience helper that diffs two snapshots and records only changed keys.
 */
export function diff<T extends Record<string, any>>(before: T, after: T): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (!shallowEqual(before?.[k], after?.[k])) {
      b[k as keyof T] = before?.[k];
      a[k as keyof T] = after?.[k];
    }
  }
  return { before: b, after: a };
}

function shallowEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
