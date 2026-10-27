/**
 * AccessSync — single source of truth for Kisi door access state.
 *
 * Door access mirrors billing/membership state automatically. The toggle on
 * the member profile is read-only by default; explicit override is permission-
 * gated and audit-logged.
 *
 * State machine:
 *   Pending  → Enabled (payment success AND required docs signed)
 *   Pending  → Cancelled (payment failed at signup)
 *   Enabled  → Disabled_Failed (failed payment past grace)
 *   Enabled  → Disabled_Frozen (freeze starts)
 *   Enabled  → Disabled_DocExpired (doc past expiry+grace)
 *   Enabled  → Disabled_Cancelled (membership cancelled)
 *   Disabled* → Enabled (recovery)
 *   Any      → Manual override (gated, audit-logged)
 *
 * Reconciliation: a nightly job compares expected vs. actual Kisi state and self-heals.
 *
 * NOTE: Calls to the Kisi API are best-effort with retry. Failures don't roll back
 * the local state change — they enqueue a retry record (WebhookDelivery is reused
 * for outbound retries with provider="KISI_OUTBOUND").
 */
import { getPrisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  kisiAddUserToGroup,
  kisiCreateUser,
  kisiDeleteMember,
  kisiListUserGroups,
  kisiRemoveUserFromGroup,
  kisiSendCredentialLink,
} from "@/lib/kisi";
import { audit } from "@/lib/audit";
import { adminNotify } from "@/lib/admin-notify";
import { isMigrationFrozen } from "@/lib/migration-freeze";

export type AccessReason =
  | "signup_success"
  | "payment_recovered"
  | "unfreeze"
  | "reactivation"
  | "doc_signed"
  | "manual_override"
  | "payment_failed"
  | "freeze_start"
  | "doc_expired"
  | "membership_cancelled"
  | "chargeback";

export type DesiredState = {
  enabled: boolean;
  reason: AccessReason;
  // Door groups (Kisi group IDs) that should be granted at each location.
  // Empty array = revoke all groups. Used when computing diffs.
  desiredGroupIds?: number[];
};

/**
 * Apply the desired access state for a member.
 * Idempotent — calling with the same state is a no-op.
 *
 * Returns the resulting state mirror (for caller to log / display).
 */
export async function applyAccessState(memberId: string, desired: DesiredState): Promise<{ enabled: boolean; reason: string }> {
  const prisma = getPrisma();

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      kisiUserId: true,
      kisiAccessEnabled: true,
      kisiAccessReason: true,
      kisiAccessUpdatedAt: true,
      locationId: true,
      organizationId: true,
    },
  });
  if (!member) throw new Error(`Member ${memberId} not found`);

  // 0. Migration freeze — GymDesk still owns Kisi shares. Report, don't act.
  if (isMigrationFrozen()) {
    console.log("[access-sync] MIGRATION_FREEZE on — skipping Kisi update", { memberId, desired: desired.enabled, reason: desired.reason });
    return { enabled: member.kisiAccessEnabled, reason: member.kisiAccessReason ?? "Migration freeze — Kisi managed by GymDesk" };
  }

  const wasEnabled = member.kisiAccessEnabled;

  // 1. Ensure Kisi user exists (lazy create on first activation / re-activation).
  //    A member who lost access was deleted from Kisi outright, so re-enabling
  //    creates a fresh Kisi identity and records it in MemberKisiLink.
  let kisiUserId = member.kisiUserId ? Number(member.kisiUserId) : null;
  if (desired.enabled && !kisiUserId) {
    try {
      const created = await kisiCreateUser({
        email: member.email,
        name: `${member.firstName} ${member.lastName}`.trim(),
        phone: member.phone,
      });
      kisiUserId = created.id;
      await prisma.member.update({
        where: { id: member.id },
        data: { kisiUserId: String(created.id) },
      });
      await prisma.memberKisiLink.create({
        data: { memberId: member.id, kisiUserId: String(created.id), kisiMemberId: created.memberId != null ? String(created.memberId) : null, email: member.email.toLowerCase() },
      }).catch((e) => console.warn("[access-sync] kisi link record failed", e));
      await kisiSendCredentialLink(created.id).catch((e: any) => {
        console.warn("[access-sync] failed to send credential link", e);
      });
    } catch (err: any) {
      console.error("[access-sync] kisiCreateUser failed", err);
      await adminNotify({
        organizationId: member.organizationId,
        locationId: member.locationId,
        kind: "integration.alert",
        severity: "ERROR",
        title: "Kisi user creation failed",
        body: `Could not create Kisi user for ${member.firstName} ${member.lastName} (${member.email}): ${err.message}`,
        link: `/admin/locations/${member.locationId}/members/list/${member.id}`,
        data: { memberId: member.id, error: err.message },
      });
      // Mark local state but don't update Kisi
      return persistMirror(member.id, false, desired.reason, "Kisi sync failed");
    }
  }

  // 2. Apply group memberships: grant desired groups, revoke every *managed* group
  //    (any group referenced by a plan's kisiDoorGroups) that is not desired.
  if (kisiUserId && desired.desiredGroupIds) {
    const want = new Set(desired.enabled ? desired.desiredGroupIds : []);
    const managed = await managedKisiGroupIds();
    const current = new Set((await kisiListUserGroups(kisiUserId).catch((e) => { console.warn("[access-sync] list groups failed", e); return []; })).map((g) => g.id));

    for (const groupId of want) {
      await kisiAddUserToGroup({ userId: kisiUserId, groupId }).catch((e) => {
        console.warn(`[access-sync] add user ${kisiUserId} to group ${groupId} failed`, e);
      });
    }
    for (const groupId of managed) {
      if (want.has(groupId)) continue;
      // Legacy GymDesk shares don't always surface as role assignments, so on a full
      // revoke we attempt removal from every managed group, not just the ones listed.
      if (!current.has(groupId) && desired.enabled) continue;
      await kisiRemoveUserFromGroup({ userId: kisiUserId, groupId }).catch((e) => {
        console.warn(`[access-sync] remove user ${kisiUserId} from group ${groupId} failed`, e);
      });
    }
  }

  // 2b. Access revoked → remove the person from Kisi entirely. Leaving disabled
  //     users in Kisi is how stale access accumulated under GymDesk. Unlock
  //     history lives in our Visit table and MemberKisiLink keeps the old ids.
  if (!desired.enabled && kisiUserId) {
    try {
      const r = await kisiDeleteMember({ userId: kisiUserId, email: member.email });
      await prisma.member.update({ where: { id: member.id }, data: { kisiUserId: null } });
      await prisma.memberKisiLink.updateMany({
        where: { memberId: member.id, kisiUserId: String(kisiUserId), unlinkedAt: null },
        data: { unlinkedAt: new Date(), unlinkReason: humanizeReason(desired.reason), ...(r.kisiMemberId != null ? { kisiMemberId: String(r.kisiMemberId) } : {}) },
      });
      // Legacy GymDesk-era links never got a row — backfill one so history is complete.
      const linked = await prisma.memberKisiLink.count({ where: { memberId: member.id, kisiUserId: String(kisiUserId) } });
      if (!linked) {
        await prisma.memberKisiLink.create({
          data: { memberId: member.id, kisiUserId: String(kisiUserId), kisiMemberId: r.kisiMemberId != null ? String(r.kisiMemberId) : null, email: member.email.toLowerCase(), linkedAt: member.kisiAccessUpdatedAt ?? new Date(), unlinkedAt: new Date(), unlinkReason: humanizeReason(desired.reason) },
        });
      }
    } catch (err: any) {
      console.error("[access-sync] kisiDeleteMember failed", err);
      await adminNotify({
        organizationId: member.organizationId,
        locationId: member.locationId,
        kind: "integration.alert",
        severity: "ERROR",
        title: "Kisi removal failed",
        body: `${member.firstName} ${member.lastName} lost door access but could not be removed from Kisi: ${err.message}. Their door groups were revoked; remove them in Kisi manually or re-run "Resync".`,
        link: `/admin/locations/${member.locationId}/members/list/${member.id}`,
        data: { memberId: member.id, kisiUserId, error: err.message },
      });
    }
  }

  // 3. Persist mirror + audit + admin notification
  const result = await persistMirror(member.id, desired.enabled, desired.reason);

  // Member-facing message only when access actually flipped (not on nightly re-asserts).
  if (wasEnabled !== desired.enabled) {
    const { emitMemberEvent } = await import("@/lib/events");
    void emitMemberEvent(desired.enabled ? "access.enabled" : "access.disabled", {
      memberId: member.id,
      locationId: member.locationId,
      organizationId: member.organizationId,
      vars: { reason: humanizeReason(desired.reason) },
    });
  }

  void audit({
    organizationId: member.organizationId,
    action: desired.enabled ? "kisi.access-enable" : "kisi.access-disable",
    entityType: "Member",
    entityId: member.id,
    before: { kisiAccessEnabled: member.kisiAccessEnabled, kisiAccessReason: member.kisiAccessReason },
    after: { kisiAccessEnabled: result.enabled, kisiAccessReason: result.reason },
    metadata: { trigger: desired.reason },
  });

  void adminNotify({
    organizationId: member.organizationId,
    locationId: member.locationId,
    kind: desired.enabled ? "door.access-enabled" : "door.access-disabled",
    severity: desired.enabled ? "INFO" : "WARN",
    title: desired.enabled
      ? `Door access enabled for ${member.firstName} ${member.lastName}`
      : `Door access disabled for ${member.firstName} ${member.lastName}`,
    body: `Reason: ${humanizeReason(desired.reason)}`,
    link: `/admin/locations/${member.locationId}/members/list/${member.id}`,
    data: { memberId: member.id, reason: desired.reason },
  });

  return result;
}

/** Every Kisi group id any plan grants (union of MembershipPlan.kisiDoorGroups) — the set we manage. */
export async function managedKisiGroupIds(): Promise<number[]> {
  const plans = await getPrisma().membershipPlan.findMany({ where: { kisiDoorGroups: { not: Prisma.DbNull } }, select: { kisiDoorGroups: true } });
  const ids = new Set<number>();
  for (const p of plans) for (const arr of Object.values((p.kisiDoorGroups as Record<string, number[]> | null) ?? {})) for (const id of arr ?? []) ids.add(Number(id));
  return [...ids];
}

async function persistMirror(memberId: string, enabled: boolean, reason: AccessReason, suffix?: string) {
  const prisma = getPrisma();
  const reasonText = humanizeReason(reason) + (suffix ? ` (${suffix})` : "");
  await prisma.member.update({
    where: { id: memberId },
    data: {
      kisiAccessEnabled: enabled,
      kisiAccessReason: reasonText,
      kisiAccessUpdatedAt: new Date(),
    },
  });
  return { enabled, reason: reasonText };
}

function humanizeReason(reason: AccessReason): string {
  switch (reason) {
    case "signup_success": return "Signup completed";
    case "payment_recovered": return "Payment recovered";
    case "unfreeze": return "Membership unfrozen";
    case "reactivation": return "Membership reactivated";
    case "doc_signed": return "Required document signed";
    case "manual_override": return "Manual override by admin";
    case "payment_failed": return "Payment failed past grace";
    case "freeze_start": return "Membership frozen";
    case "doc_expired": return "Required document expired";
    case "membership_cancelled": return "Membership cancelled";
    case "chargeback": return "Chargeback received";
    default: return reason;
  }
}

/**
 * Compute desired access state for a member based on their current
 * subscriptions, document state, and billing state.
 *
 * Used by the nightly reconciliation job and by event handlers.
 */
export async function computeDesiredAccessState(memberId: string): Promise<DesiredState> {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      membershipSubscriptions: {
        where: { status: { in: ["ACTIVE", "CANCEL_SCHEDULED", "COMP"] } },
        include: { plan: true },
      },
      documentAssignments: {
        where: { status: { in: ["SENT", "VIEWED", "AWAITING_COUNTER", "EXPIRED"] } },
        include: { document: true },
      },
      invoices: {
        where: { status: { in: ["PAST_DUE", "FAILED"] } },
      },
    },
  });

  if (!member) return { enabled: false, reason: "membership_cancelled", desiredGroupIds: [] };

  // Disabled if no active subscription (frozen members read as frozen, not cancelled)
  if (member.membershipSubscriptions.length === 0) {
    const frozen = await prisma.membershipSubscription.count({ where: { memberId, status: "FROZEN" } });
    return { enabled: false, reason: frozen ? "freeze_start" : "membership_cancelled", desiredGroupIds: [] };
  }

  // Disabled if any required document is unsigned past grace
  const requiredUnsigned = member.documentAssignments.find(
    (da) => da.document.requiredAtSignup && (da.status !== "SIGNED")
  );
  if (requiredUnsigned) {
    return { enabled: false, reason: requiredUnsigned.status === "EXPIRED" ? "doc_expired" : "signup_success", desiredGroupIds: [] };
  }

  // Disabled if there's an unresolved past-due invoice past grace (grace logic
  // computed upstream in the dunning runner; here we simply respect the flag).
  if (member.invoices.length > 0) {
    return { enabled: false, reason: "payment_failed", desiredGroupIds: [] };
  }

  // Enabled — collect Kisi groups from all active subscriptions
  const groupIds: number[] = [];
  for (const sub of member.membershipSubscriptions) {
    const groups = (sub.plan.kisiDoorGroups as Record<string, number[]> | null) ?? null;
    if (groups && member.locationId in groups) {
      groupIds.push(...groups[member.locationId]);
    }
  }

  return { enabled: true, reason: "signup_success", desiredGroupIds: Array.from(new Set(groupIds)) };
}
