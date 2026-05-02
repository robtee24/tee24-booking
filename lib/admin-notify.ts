/**
 * Write to the admin notifications inbox + dashboard stream.
 * (Distinct from the existing booking-side `lib/notify.ts` which sends Email/SMS to guests.)
 */
import { getPrisma } from "@/lib/db";

export type AdminNotificationKind =
  | "payment.received" | "payment.failed" | "payment.refunded" | "payment.chargeback"
  | "billing.payment-succeeded" | "billing.payment-failed" | "billing.refund-issued"
  | "membership.signup" | "membership.cancel" | "membership.cancelled" | "membership.cancel-scheduled"
  | "membership.freeze" | "membership.unfreeze"
  | "membership.expired" | "membership.reactivated"
  | "door.unlock" | "door.unlock-unusual-time" | "door.access-disabled" | "door.access-enabled"
  | "document.signed" | "document.expired"
  | "task.assigned" | "task.due"
  | "automation.triggered" | "automation.failed"
  | "integration.alert" | "integration.recovered"
  | "anomaly.mass-cancel"
  | "churn.threshold"
  | "birthday.today" | "anniversary.today"
  | "message.inbound" | "message.outbound"
  // Allow any additional string for forward-compatibility
  | (string & {});

export type AdminSeverity = "INFO" | "WARN" | "ERROR";

export type AdminNotificationInput = {
  organizationId?: string | null;
  locationId?: string | null;
  kind: AdminNotificationKind;
  severity?: AdminSeverity;
  title: string;
  body?: string;
  link?: string;
  data?: any;
};

export async function adminNotify(input: AdminNotificationInput): Promise<void> {
  try {
    await getPrisma().adminNotification.create({
      data: {
        organizationId: input.organizationId ?? undefined,
        locationId: input.locationId ?? undefined,
        kind: input.kind,
        severity: input.severity ?? "INFO",
        title: input.title,
        body: input.body ?? undefined,
        link: input.link ?? undefined,
        data: input.data ?? undefined,
      },
    });
  } catch (err) {
    console.error("[admin-notify] failed", input.kind, err);
  }
}
