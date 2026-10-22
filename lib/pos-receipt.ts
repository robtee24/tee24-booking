// lib/pos-receipt.ts
// Receipt email for point-of-sale transactions. Rendered server-side and sent
// through `lib/notify.ts` (Resend). Never throws into the caller.
import { formatInTimeZone } from "date-fns-tz";
import { sendEmail } from "@/lib/notify";
import type { SaleDTO } from "@/components/admin/sales/types";
import { PAYMENT_KIND_LABELS } from "@/components/admin/sales/types";

export type ReceiptLocation = {
  name: string;
  businessName?: string | null;
  logoUrl?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  timezone: string;
  currency: string;
};

function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function receiptSubject(sale: SaleDTO, location: ReceiptLocation): string {
  const name = location.businessName || location.name;
  if (sale.status === "REFUNDED") return `Refund for sale #${sale.number} — ${name}`;
  if (sale.status === "VOID") return `Sale #${sale.number} voided — ${name}`;
  return `Your receipt from ${name} — sale #${sale.number}`;
}

export function buildReceiptHtml(sale: SaleDTO, location: ReceiptLocation): string {
  const cur = location.currency || "USD";
  const name = location.businessName || location.name;
  const when = formatInTimeZone(new Date(sale.createdAt), location.timezone || "America/New_York", "MMM d, yyyy 'at' h:mm a zzz");
  const address = [location.addressLine1, location.addressLine2, [location.city, location.state].filter(Boolean).join(", ") + (location.zip ? ` ${location.zip}` : "")]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);

  const rows = sale.lineItems
    .map(
      (li) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee;">${esc(li.description)}${li.quantity !== 1 ? `<div style="color:#8e8e93;font-size:12px;">${li.quantity} × ${money(li.unitCents, cur)}</div>` : ""}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">${money(li.totalCents, cur)}</td>
        </tr>`,
    )
    .join("");

  const totalsRow = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:4px 0;color:${bold ? "#1c1c1e" : "#3c3c43"};${bold ? "font-weight:600;" : ""}">${label}</td><td style="padding:4px 0;text-align:right;${bold ? "font-weight:600;" : ""}">${value}</td></tr>`;

  const payment = PAYMENT_KIND_LABELS[sale.paymentKind] ?? sale.paymentKind;
  const paymentDetail: string[] = [];
  if (sale.payment.tenderedCents != null) paymentDetail.push(`Tendered ${money(sale.payment.tenderedCents, cur)}`);
  if (sale.payment.changeCents != null && sale.payment.changeCents > 0) paymentDetail.push(`Change ${money(sale.payment.changeCents, cur)}`);
  if (sale.payment.reference) paymentDetail.push(`Ref ${esc(sale.payment.reference)}`);
  if (sale.payment.giftCardLast4) paymentDetail.push(`Gift card ****-${esc(sale.payment.giftCardLast4)}`);

  const statusBanner =
    sale.status === "REFUNDED"
      ? `<div style="margin:0 0 16px;padding:10px 12px;border-radius:10px;background:#fff4e5;color:#9a5b00;font-size:13px;">This sale was refunded${sale.refundedCents ? ` (${money(sale.refundedCents, cur)})` : ""}.</div>`
      : sale.status === "VOID"
        ? `<div style="margin:0 0 16px;padding:10px 12px;border-radius:10px;background:#fdecec;color:#a30000;font-size:13px;">This sale was voided.</div>`
        : sale.refundedCents > 0
          ? `<div style="margin:0 0 16px;padding:10px 12px;border-radius:10px;background:#fff4e5;color:#9a5b00;font-size:13px;">Partial refund issued: ${money(sale.refundedCents, cur)}.</div>`
          : "";

  return `<!doctype html>
<html><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c1e;">
  <div style="max-width:520px;margin:24px auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.06);">
    ${location.logoUrl ? `<img src="${esc(location.logoUrl)}" alt="${esc(name)}" style="max-height:48px;margin-bottom:16px;" />` : `<div style="font-size:20px;font-weight:700;margin-bottom:16px;">${esc(name)}</div>`}
    <div style="font-size:13px;color:#8e8e93;margin-bottom:20px;">
      Receipt for sale #${sale.number}<br/>${esc(when)}${sale.staffName ? `<br/>Served by ${esc(sale.staffName)}` : ""}
    </div>
    ${statusBanner}
    ${sale.customerName ? `<div style="font-size:14px;margin-bottom:16px;">Customer: <strong>${esc(sale.customerName)}</strong></div>` : ""}
    <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px;">
      ${totalsRow("Subtotal", money(sale.subtotalCents, cur))}
      ${sale.discountCents ? totalsRow("Discount", `−${money(sale.discountCents, cur)}`) : ""}
      ${sale.taxCents ? totalsRow("Tax", money(sale.taxCents, cur)) : ""}
      ${totalsRow("Total", money(sale.totalCents, cur), true)}
      ${totalsRow("Paid with", esc(payment) + (paymentDetail.length ? `<div style="color:#8e8e93;font-size:12px;">${paymentDetail.join(" · ")}</div>` : ""))}
    </table>
    ${sale.notes ? `<div style="margin-top:16px;font-size:13px;color:#3c3c43;white-space:pre-wrap;">${esc(sale.notes)}</div>` : ""}
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#8e8e93;line-height:1.5;">
      ${esc(name)}${address.length ? `<br/>${address.map(esc).join("<br/>")}` : ""}${location.phone ? `<br/>${esc(location.phone)}` : ""}${location.email ? `<br/>${esc(location.email)}` : ""}
      <br/><br/>Thanks for visiting!
    </div>
  </div>
</body></html>`;
}

/** Send the receipt to `to`. Resolves false when nothing was sent. */
export async function sendSaleReceipt(sale: SaleDTO, location: ReceiptLocation, to?: string | null): Promise<boolean> {
  const recipient = (to ?? sale.customerEmail ?? "").trim();
  if (!recipient || !recipient.includes("@")) return false;
  try {
    await sendEmail({ to: recipient, subject: receiptSubject(sale, location), html: buildReceiptHtml(sale, location) });
    return true;
  } catch (e) {
    console.error("[pos-receipt] failed to send receipt", e);
    return false;
  }
}
