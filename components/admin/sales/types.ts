// components/admin/sales/types.ts
// Client-safe DTOs shared by the POS UI and `services/pos.service.ts`.
// Keep this file free of server imports — it is bundled into client components.

export type SaleStatus = "PAID" | "REFUNDED" | "VOID" | "PENDING";
export type PaymentKind = "CARD" | "CASH" | "CREDIT" | "GIFT_CARD" | "OTHER";
export type GiftCardStatus = "ACTIVE" | "DEPLETED" | "VOID";

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  CASH: "Cash",
  OTHER: "Other / external terminal",
  CREDIT: "Member credit",
  GIFT_CARD: "Gift card",
  CARD: "Card (Square)",
};

/** Compact labels for badges / tight table cells. */
export const PAYMENT_KIND_SHORT: Record<PaymentKind, string> = {
  CASH: "Cash",
  OTHER: "Other",
  CREDIT: "Credit",
  GIFT_CARD: "Gift card",
  CARD: "Card",
};

export type CategoryDTO = {
  id: string;
  name: string;
  sortOrder: number;
  productCount?: number;
};

export type ProductDTO = {
  id: string;
  locationId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  description: string | null;
  sku: string | null;
  priceCents: number;
  cogsCents: number | null;
  taxable: boolean;
  trackInventory: boolean;
  inventory: number;
  lowStockAt: number | null;
  imageUrl: string | null;
  glCode: string | null;
  incomeCategory: string | null;
  active: boolean;
  lowStock: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductInput = {
  name: string;
  description?: string | null;
  categoryId?: string | null;
  sku?: string | null;
  priceCents: number;
  cogsCents?: number | null;
  taxable: boolean;
  trackInventory: boolean;
  inventory?: number;
  lowStockAt?: number | null;
  imageUrl?: string | null;
  glCode?: string | null;
  incomeCategory?: string | null;
  active?: boolean;
  /** "all" = every location in the org, "location" = only this location */
  scope: "all" | "location";
};

export type SaleLineItemDTO = {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
};

export type SaleRefundRecord = {
  amountCents: number;
  at: string;
  reason: string | null;
  lineItemIds: string[];
  kind: "refund" | "void";
};

export type SaleDTO = {
  id: string;
  number: number;
  locationId: string;
  memberId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  staffId: string | null;
  staffName: string | null;
  status: SaleStatus;
  paymentKind: PaymentKind;
  chargeId: string | null;
  giftCardId: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  refundedCents: number;
  refunds: SaleRefundRecord[];
  payment: SalePaymentMeta;
  notes: string | null;
  createdAt: string;
  refundedAt: string | null;
  lineItems: SaleLineItemDTO[];
};

/** Payment details that don't have a column — persisted inside `Sale.notes` as a trailer. */
export type SalePaymentMeta = {
  tenderedCents?: number;
  changeCents?: number;
  reference?: string;
  giftCardLast4?: string;
  cardLast4?: string;
};

export type CartLineInput = {
  productId?: string | null;
  description: string;
  quantity: number;
  unitCents: number;
  taxable: boolean;
  /** Set when this line sells a new gift card. */
  giftCard?: { recipientName?: string | null; recipientEmail?: string | null } | null;
};

export type DiscountInput = { kind: "amount" | "percent"; value: number } | null;

export type PaymentInput =
  | { kind: "CASH"; tenderedCents?: number | null }
  | { kind: "OTHER"; reference?: string | null }
  | { kind: "CREDIT" }
  | { kind: "GIFT_CARD"; code: string }
  | { kind: "CARD"; sourceId: string };

export type CreateSaleRequest = {
  items: CartLineInput[];
  discount: DiscountInput;
  customer: { memberId?: string | null; name?: string | null; email?: string | null };
  notes?: string | null;
  payment: PaymentInput;
  sendReceipt?: boolean;
};

export type GiftCardDTO = {
  id: string;
  codeMasked: string;
  last4: string;
  initialCents: number;
  balanceCents: number;
  purchaserMemberId: string | null;
  purchaserName: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  status: GiftCardStatus;
  expiresAt: string | null;
  createdAt: string;
};

export type GiftCardLookupDTO = GiftCardDTO & { usable: boolean; reason: string | null };

export type CustomerDTO = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  creditCents: number;
};

export type PosContextDTO = {
  location: { id: string; name: string; slug: string; taxRateBps: number; currency: string; timezone: string };
  categories: CategoryDTO[];
  products: ProductDTO[];
  squareReady: boolean;
};

export type SalesListFilters = {
  from?: string;
  to?: string;
  staffId?: string;
  paymentKind?: PaymentKind | "";
  status?: SaleStatus | "";
  q?: string;
};

export type StaffDTO = { id: string; name: string };

export type SalesSummaryDTO = {
  from: string;
  to: string;
  totals: {
    count: number;
    grossCents: number;
    discountCents: number;
    taxCents: number;
    refundedCents: number;
    netCents: number;
  };
  byIncomeCategory: Array<{ incomeCategory: string; netCents: number; count: number }>;
  byGlCode: Array<{ glCode: string; netCents: number; count: number }>;
  byPaymentKind: Array<{ paymentKind: PaymentKind; netCents: number; count: number }>;
};

export type SalesReportDTO = {
  from: string;
  to: string;
  kpis: {
    revenueCents: number;
    cogsCents: number;
    grossProfitCents: number;
    taxCents: number;
    discountCents: number;
    refundedCents: number;
    saleCount: number;
    avgSaleCents: number;
  };
  byDay: Array<{ day: string; revenueCents: number; count: number }>;
  byProduct: Array<{ productId: string | null; name: string; quantity: number; revenueCents: number; cogsCents: number }>;
  byCategory: Array<{ name: string; quantity: number; revenueCents: number }>;
  byPaymentKind: Array<{ paymentKind: PaymentKind; count: number; revenueCents: number }>;
  byStaff: Array<{ staffId: string | null; name: string; count: number; revenueCents: number }>;
  lowInventory: Array<{ id: string; name: string; sku: string | null; inventory: number; lowStockAt: number | null }>;
};
