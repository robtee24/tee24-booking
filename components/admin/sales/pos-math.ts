// components/admin/sales/pos-math.ts
// Pure money math shared by the New Sale screen (preview) and the service
// (authoritative). No imports — safe for client and server.

import type { CartLineInput, DiscountInput } from "./types";

export type SaleTotals = {
  subtotalCents: number;
  discountCents: number;
  taxableAfterDiscountCents: number;
  taxCents: number;
  totalCents: number;
  lines: Array<{ totalCents: number }>;
};

export function lineTotal(line: Pick<CartLineInput, "quantity" | "unitCents">): number {
  return Math.round(line.quantity * line.unitCents);
}

/**
 * Totals for a cart.
 * - Discount is applied to the subtotal (capped at the subtotal).
 * - Tax is computed on the taxable share of the discounted subtotal, so a
 *   $-off or %-off discount reduces tax proportionally.
 */
export function computeSaleTotals(items: CartLineInput[], discount: DiscountInput, taxRateBps: number): SaleTotals {
  const lines = items.map((l) => ({ totalCents: lineTotal(l) }));
  const subtotalCents = lines.reduce((s, l) => s + l.totalCents, 0);
  const taxableSubtotal = items.reduce((s, l) => s + (l.taxable ? lineTotal(l) : 0), 0);

  let discountCents = 0;
  if (discount && discount.value > 0 && subtotalCents > 0) {
    discountCents =
      discount.kind === "percent"
        ? Math.round((subtotalCents * Math.min(discount.value, 100)) / 100)
        : Math.round(discount.value);
    discountCents = Math.max(0, Math.min(discountCents, subtotalCents));
  }

  const taxableAfterDiscountCents =
    subtotalCents > 0 ? Math.round(taxableSubtotal - discountCents * (taxableSubtotal / subtotalCents)) : 0;
  const taxCents = taxRateBps > 0 ? Math.round((taxableAfterDiscountCents * taxRateBps) / 10_000) : 0;
  const totalCents = subtotalCents - discountCents + taxCents;

  return { subtotalCents, discountCents, taxableAfterDiscountCents, taxCents, totalCents, lines };
}

/** Parse a user-entered dollar string ("12", "12.5", "$12.50") into cents. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}
