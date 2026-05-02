/**
 * Field mappings: Gymdesk CSV column → Tee24 Prisma field.
 *
 * Adjust the keys to match the exact column names in the Gymdesk export
 * once we receive it; types are conservative and tested against the Prisma
 * schema.
 */

export type GymdeskMember = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth?: string;
  address_line_1?: string;
  city?: string;
  state?: string;
  zip?: string;
  status?: "active" | "frozen" | "cancelled" | "visitor";
  membership_type?: string;
  join_date?: string;
  email_marketing?: "true" | "false";
  sms_marketing?: "true" | "false";
  square_customer_id?: string;
  kisi_user_id?: string;
};

export type GymdeskPayment = {
  id: string;
  member_id: string;
  amount_cents: string;
  description?: string;
  status: "paid" | "scheduled" | "failed" | "refunded";
  due_date?: string;
  paid_at?: string;
  square_payment_id?: string;
  square_invoice_id?: string;
};

export type GymdeskAttendance = {
  id: string;
  member_id?: string;
  visitor_id?: string;
  location_id?: string;
  bay_id?: string;
  type?: "reservation" | "walk_in" | "day_pass" | "class" | "manual";
  source?: "kisi" | "manual" | "bay_app";
  entered_at: string;
  exited_at?: string;
  kisi_event_id?: string;
};

export type GymdeskDocument = {
  id: string;
  name: string;
  body_html?: string;
  required_at_signup?: "true" | "false";
  expires_after_days?: string;
};

export type GymdeskDocumentAssignment = {
  id: string;
  document_id: string;
  member_id: string;
  status: "sent" | "viewed" | "signed" | "declined" | "expired" | "voided";
  signed_at?: string;
  pdf_url?: string;
};

export const STATUS_MAP: Record<string, string> = {
  active: "ACTIVE",
  frozen: "FROZEN",
  cancelled: "CANCELLED",
  visitor: "VISITOR",
  pending: "PENDING",
};

export const PAYMENT_STATUS_MAP: Record<string, string> = {
  paid: "PAID",
  scheduled: "SCHEDULED",
  failed: "FAILED",
  refunded: "REFUNDED",
};

export const VISIT_TYPE_MAP: Record<string, string> = {
  reservation: "RESERVATION",
  walk_in: "WALK_IN",
  day_pass: "DAY_PASS",
  class: "CLASS",
  manual: "MANUAL",
};

export const DOC_STATUS_MAP: Record<string, string> = {
  sent: "SENT",
  viewed: "VIEWED",
  signed: "SIGNED",
  declined: "DECLINED",
  expired: "EXPIRED",
  voided: "VOIDED",
};

/**
 * Dedupe key: case-insensitive email + last7 of phone.
 * Two members hashing to the same key are merged.
 */
export function memberDedupeKey(m: { email?: string | null; phone?: string | null }): string {
  const e = (m.email ?? "").trim().toLowerCase();
  const p = (m.phone ?? "").replace(/\D/g, "").slice(-7);
  return `${e}|${p}`;
}
