// Client-safe constants for the marketing module (no server imports).

/**
 * Lead pipeline stages. ENGAGED is the legacy name for CONTACTED and is
 * treated as the same stage everywhere.
 */
export const LEAD_STAGES = ["NEW", "CONTACTED", "BOOKED", "TRIAL", "CONVERTED", "LOST"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export function normalizeLeadStage(stage: string | null | undefined): LeadStage {
  if (stage === "ENGAGED") return "CONTACTED";
  if ((LEAD_STAGES as readonly string[]).includes(stage ?? "")) return stage as LeadStage;
  return "NEW";
}

export const LEAD_STAGE_TONES: Record<LeadStage, "info" | "warn" | "success" | "muted" | "default" | "danger"> = {
  NEW: "info",
  CONTACTED: "default",
  BOOKED: "warn",
  TRIAL: "warn",
  CONVERTED: "success",
  LOST: "muted",
};

export const AUTOMATION_TRIGGER_OPTIONS: { value: string; label: string; group: string }[] = [
  { value: "member.created", label: "Member created (admin, import or signup)", group: "Members" },
  { value: "member.signup", label: "Completed public signup form", group: "Members" },
  { value: "member.welcome", label: "Welcome / account access sent", group: "Members" },
  { value: "member.birthday", label: "Birthday", group: "Members" },
  { value: "tag.added", label: "Tag added", group: "Members" },
  { value: "inactive-for-days", label: "No visit for N days", group: "Members" },
  { value: "manual", label: "Manual enrollment only", group: "Members" },
  { value: "membership.activated", label: "Membership activated", group: "Memberships" },
  { value: "membership.renewed", label: "Membership renewed", group: "Memberships" },
  { value: "membership.cancel-scheduled", label: "Cancellation scheduled", group: "Memberships" },
  { value: "membership.cancelled", label: "Membership cancelled", group: "Memberships" },
  { value: "membership.frozen", label: "Membership frozen", group: "Memberships" },
  { value: "membership.resumed", label: "Membership resumed", group: "Memberships" },
  { value: "membership.expiring", label: "Membership expiring soon", group: "Memberships" },
  { value: "membership.expired", label: "Membership expired", group: "Memberships" },
  { value: "trial.started", label: "Trial started", group: "Memberships" },
  { value: "trial.expired", label: "Trial expired", group: "Memberships" },
  { value: "payment.succeeded", label: "Payment succeeded", group: "Payments" },
  { value: "payment.failed", label: "Payment failed", group: "Payments" },
  { value: "payment.refunded", label: "Payment refunded", group: "Payments" },
  { value: "payment.overdue", label: "Payment overdue", group: "Payments" },
  { value: "payment.upcoming", label: "Upcoming charge", group: "Payments" },
  { value: "card.expiring", label: "Card expiring", group: "Payments" },
  { value: "card.expired", label: "Card expired", group: "Payments" },
  { value: "document.assigned", label: "Document assigned", group: "Documents" },
  { value: "document.signed", label: "Document signed", group: "Documents" },
  { value: "document.expired", label: "Document expired", group: "Documents" },
  { value: "visit.checked-in", label: "Checked in", group: "Attendance" },
  { value: "sale.completed", label: "Sale completed", group: "Sales" },
];

export const STEP_KIND_LABELS: Record<string, string> = {
  SEND_EMAIL: "Send email",
  SEND_SMS: "Send SMS",
  WAIT: "Wait",
  ADD_TAG: "Add tag",
  REMOVE_TAG: "Remove tag",
  CHANGE_STATUS: "Change status",
  CREATE_TASK: "Create staff task",
  WEBHOOK: "Call webhook",
  SPLIT: "Split (condition)",
  EXIT: "Exit",
};
