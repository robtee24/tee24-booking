/**
 * Member CSV export — honours the same filter object as the list API.
 */
import { queryMembers, type MemberQuery } from "@/services/member.service";

const COLUMNS = [
  "id", "first_name", "last_name", "email", "phone", "status", "membership", "membership_status",
  "paid_through", "joined", "dob", "gender", "checkin_code", "last_visit", "next_invoice_due", "next_invoice_amount",
  "overdue_amount", "card_on_file", "door_access", "tags",
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) s = Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  else s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // defuse spreadsheet formula injection
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportMembersCsv(q: MemberQuery): Promise<{ csv: string; count: number }> {
  const lines: string[] = [COLUMNS.join(",")];
  let page = 1;
  let count = 0;
  for (;;) {
    const res = await queryMembers({ ...q, page, pageSize: 200 });
    for (const m of res.items) {
      count++;
      lines.push([
        m.id, m.firstName, m.lastName, m.email, m.phone, m.status,
        m.subscription?.planName ?? m.membershipType ?? "", m.subscription?.status ?? "",
        m.subscription?.paidThroughDate ?? "", m.joinDate ?? "", m.dob ?? "", m.gender ?? "", m.checkinCode ?? "",
        m.lastVisitAt ? m.lastVisitAt.toISOString() : "", m.billing.nextInvoiceDue ?? "",
        m.billing.nextInvoiceCents != null ? (m.billing.nextInvoiceCents / 100).toFixed(2) : "",
        (m.billing.overdueCents / 100).toFixed(2), m.billing.hasCard ? "yes" : "no", m.kisiAccessEnabled ? "enabled" : "disabled",
        m.memberTags.map((t) => t.tag.name).join("; "),
      ].map(csvCell).join(","));
    }
    if (res.items.length < 200 || page * 200 >= res.total) break;
    page++;
  }
  return { csv: lines.join("\r\n") + "\r\n", count };
}
