/**
 * POST /api/admin/invoices/bulk { locationSlug, ids: string[], action: "retry" | "mark-paid" | "write-off", method?, reason? }
 *   retry      → charge each invoice with the member's default card   (billing.charge)
 *   mark-paid  → record cash/other payment                            (billing.charge)
 *   write-off  → cancel invoices                                       (billing.write-off)
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { chargeInvoiceWithDefaultCard, markInvoicePaidManually, writeOffInvoice, type ManualPaymentMethod } from "@/services/billing.service";
import { errorResponse, guardBilling } from "../../billing/_shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const permission = action === "write-off" ? "billing.write-off" : "billing.charge";
  const g = await guardBilling({ locationSlug: body.locationSlug, locationId: body.locationId }, permission);
  if (!g.ok) return g.response;
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : [];
  if (ids.length === 0) return NextResponse.json({ error: "No invoices selected" }, { status: 400 });

  // Only act on invoices at this location
  const invoices = await getPrisma().invoice.findMany({ where: { id: { in: ids }, locationId: g.location.id }, select: { id: true, number: true } });
  const results: Array<{ id: string; number: number; ok: boolean; error?: string }> = [];
  for (const inv of invoices) {
    try {
      if (action === "retry") await chargeInvoiceWithDefaultCard(inv.id, g.actorId);
      else if (action === "mark-paid") {
        const method = String(body.method ?? "CASH").toUpperCase() as ManualPaymentMethod;
        await markInvoicePaidManually({ invoiceId: inv.id, method: ["CASH", "CHECK", "OTHER"].includes(method) ? method : "CASH", note: body.note ? String(body.note) : undefined, actorId: g.actorId });
      } else if (action === "write-off") await writeOffInvoice(inv.id, { reason: body.reason ? String(body.reason) : undefined, actorId: g.actorId });
      else return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
      results.push({ id: inv.id, number: inv.number, ok: true });
    } catch (e) {
      if (e instanceof Error && /Unknown action/.test(e.message)) return errorResponse(e);
      results.push({ id: inv.id, number: inv.number, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: true, results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
}
