// services/pos.service.ts
// Lean point-of-sale: products, categories, sales, gift cards, reporting.
//
// Payment handling:
//  - CASH / OTHER: recorded only.
//  - CREDIT: debits the member credit ledger (negative MemberCredit row via addCredit).
//  - GIFT_CARD: debits GiftCard.balanceCents (full coverage required).
//  - CARD: env-gated behind `squareReady()`; charges via `squareCreatePayment`
//    with a Web Payments SDK `sourceId` and stores a Charge row.
//
// Schema has no column for tendered/change/reference or partial refunds, so
// those are persisted as a JSON trailer inside `Sale.notes` (see meta helpers).
import { randomInt } from "crypto";
import { formatInTimeZone } from "date-fns-tz";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";
import { squareCreatePayment, squareCreateRefund } from "@/lib/square";
import { addCredit, getCreditBalanceCents } from "@/services/billing.service";
import { sendSaleReceipt, type ReceiptLocation } from "@/lib/pos-receipt";
import { computeSaleTotals } from "@/components/admin/sales/pos-math";
import type {
  CartLineInput,
  CategoryDTO,
  CreateSaleRequest,
  CustomerDTO,
  GiftCardDTO,
  GiftCardLookupDTO,
  PaymentKind,
  PosContextDTO,
  ProductDTO,
  ProductInput,
  SaleDTO,
  SalePaymentMeta,
  SaleRefundRecord,
  SaleStatus,
  SalesListFilters,
  SalesReportDTO,
  SalesSummaryDTO,
  StaffDTO,
} from "@/components/admin/sales/types";

/** Local Square readiness check (lib/square.ts is owned by the billing worker). */
export const squareReady = () => !!(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);

export class PosError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "PosError";
  }
}

type LocationCtx = {
  id: string;
  slug: string;
  name: string;
  organizationId: string | null;
  taxRateBps: number;
  currency: string;
  timezone: string;
};

const LOCATION_SELECT = {
  id: true, slug: true, name: true, organizationId: true, taxRateBps: true, currency: true, timezone: true,
  businessName: true, logoUrl: true, addressLine1: true, addressLine2: true, city: true, state: true, zip: true, phone: true, email: true,
} as const;

type LocationFull = Prisma.LocationGetPayload<{ select: typeof LOCATION_SELECT }>;

export async function getPosLocation(slugOrId: { slug?: string; id?: string }): Promise<LocationFull> {
  const prisma = getPrisma();
  const where = slugOrId.id ? { id: slugOrId.id } : { slug: slugOrId.slug ?? "" };
  const loc = await prisma.location.findUnique({ where, select: LOCATION_SELECT });
  if (!loc) throw new PosError("Location not found", 404);
  return loc;
}

function orgWhere(organizationId: string | null) {
  return organizationId ? { organizationId } : { organizationId: null };
}

/* ───────────────────────────── notes meta trailer ─────────────────────── */

const META_MARKER = "\n[[pos-meta]]";
type SaleMeta = { payment?: SalePaymentMeta; refunds?: SaleRefundRecord[] };

function splitNotes(raw: string | null): { notes: string | null; meta: SaleMeta } {
  if (!raw) return { notes: null, meta: {} };
  const i = raw.indexOf(META_MARKER);
  if (i < 0) return { notes: raw || null, meta: {} };
  const notes = raw.slice(0, i).trim() || null;
  try {
    return { notes, meta: JSON.parse(raw.slice(i + META_MARKER.length)) as SaleMeta };
  } catch {
    return { notes, meta: {} };
  }
}

function joinNotes(notes: string | null | undefined, meta: SaleMeta): string | null {
  const clean = (notes ?? "").trim();
  const hasMeta = (meta.payment && Object.keys(meta.payment).length > 0) || (meta.refunds && meta.refunds.length > 0);
  if (!hasMeta) return clean || null;
  return `${clean}${META_MARKER}${JSON.stringify(meta)}`;
}

/* ───────────────────────────── categories ─────────────────────────────── */

export async function listCategories(loc: LocationCtx): Promise<CategoryDTO[]> {
  const rows = await getPrisma().productCategory.findMany({
    where: orgWhere(loc.organizationId),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } } },
  });
  return rows.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder, productCount: c._count.products }));
}

export async function createCategory(loc: LocationCtx, input: { name: string; sortOrder?: number }, actorId: string) {
  const name = input.name.trim();
  if (!name) throw new PosError("Category name is required");
  const prisma = getPrisma();
  const existing = await prisma.productCategory.findFirst({ where: { ...orgWhere(loc.organizationId), name: { equals: name, mode: "insensitive" } } });
  if (existing) return existing;
  const max = await prisma.productCategory.aggregate({ where: orgWhere(loc.organizationId), _max: { sortOrder: true } });
  const row = await prisma.productCategory.create({
    data: { organizationId: loc.organizationId, name, sortOrder: input.sortOrder ?? (max._max.sortOrder ?? -1) + 1 },
  });
  void audit({ organizationId: loc.organizationId, actorId, action: "settings.update", entityType: "ProductCategory", entityId: row.id, after: row });
  return row;
}

export async function updateCategory(loc: LocationCtx, id: string, input: { name?: string; sortOrder?: number }, actorId: string) {
  const prisma = getPrisma();
  const before = await prisma.productCategory.findFirst({ where: { id, ...orgWhere(loc.organizationId) } });
  if (!before) throw new PosError("Category not found", 404);
  const row = await prisma.productCategory.update({
    where: { id },
    data: { ...(input.name != null ? { name: input.name.trim() } : {}), ...(input.sortOrder != null ? { sortOrder: input.sortOrder } : {}) },
  });
  void audit({ organizationId: loc.organizationId, actorId, action: "settings.update", entityType: "ProductCategory", entityId: id, before, after: row });
  return row;
}

export async function deleteCategory(loc: LocationCtx, id: string, actorId: string) {
  const prisma = getPrisma();
  const before = await prisma.productCategory.findFirst({ where: { id, ...orgWhere(loc.organizationId) } });
  if (!before) throw new PosError("Category not found", 404);
  await prisma.productCategory.delete({ where: { id } }); // products → categoryId SetNull
  void audit({ organizationId: loc.organizationId, actorId, action: "settings.update", entityType: "ProductCategory", entityId: id, before, metadata: { deleted: true } });
}

/* ───────────────────────────── products ───────────────────────────────── */

type ProductRow = Prisma.ProductGetPayload<{ include: { category: { select: { name: true } } } }>;

function toProductDTO(p: ProductRow): ProductDTO {
  return {
    id: p.id,
    locationId: p.locationId,
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? null,
    name: p.name,
    description: p.description,
    sku: p.sku,
    priceCents: p.priceCents,
    cogsCents: p.cogsCents,
    taxable: p.taxable,
    trackInventory: p.trackInventory,
    inventory: p.inventory,
    lowStockAt: p.lowStockAt,
    imageUrl: p.imageUrl,
    glCode: p.glCode,
    incomeCategory: p.incomeCategory,
    active: p.active,
    lowStock: p.trackInventory && p.lowStockAt != null && p.inventory <= p.lowStockAt,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function productScopeWhere(loc: LocationCtx): Prisma.ProductWhereInput {
  return { ...orgWhere(loc.organizationId), OR: [{ locationId: null }, { locationId: loc.id }] };
}

export async function listProducts(
  loc: LocationCtx,
  opts: { q?: string; categoryId?: string; active?: "all" | "active" | "archived"; lowStock?: boolean } = {},
): Promise<ProductDTO[]> {
  const where: Prisma.ProductWhereInput = { ...productScopeWhere(loc) };
  if (opts.active === "active" || opts.active === undefined) where.active = true;
  else if (opts.active === "archived") where.active = false;
  if (opts.categoryId) where.categoryId = opts.categoryId === "none" ? null : opts.categoryId;
  if (opts.q?.trim()) {
    const q = opts.q.trim();
    where.AND = [{ OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] }];
  }
  const rows = await getPrisma().product.findMany({
    where,
    include: { category: { select: { name: true } } },
    orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
  });
  let out = rows.map(toProductDTO);
  if (opts.lowStock) out = out.filter((p) => p.lowStock);
  return out;
}

export async function getProduct(loc: LocationCtx, id: string): Promise<ProductDTO> {
  const row = await getPrisma().product.findFirst({ where: { id, ...productScopeWhere(loc) }, include: { category: { select: { name: true } } } });
  if (!row) throw new PosError("Product not found", 404);
  return toProductDTO(row);
}

function normalizeProductInput(input: Partial<ProductInput>, loc: LocationCtx, partial = false): Prisma.ProductUncheckedUpdateInput {
  const data: Prisma.ProductUncheckedUpdateInput = {};
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new PosError("Name is required");
    data.name = name;
  } else if (!partial) throw new PosError("Name is required");
  if (input.priceCents !== undefined) {
    if (!Number.isInteger(input.priceCents) || input.priceCents < 0) throw new PosError("Price must be a non-negative amount");
    data.priceCents = input.priceCents;
  } else if (!partial) throw new PosError("Price is required");
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.categoryId !== undefined) data.categoryId = input.categoryId || null;
  if (input.sku !== undefined) data.sku = input.sku?.trim() || null;
  if (input.cogsCents !== undefined) {
    if (input.cogsCents != null && (!Number.isInteger(input.cogsCents) || input.cogsCents < 0)) throw new PosError("COGS must be a non-negative amount");
    data.cogsCents = input.cogsCents ?? null;
  }
  if (input.taxable !== undefined) data.taxable = !!input.taxable;
  if (input.trackInventory !== undefined) data.trackInventory = !!input.trackInventory;
  if (input.inventory !== undefined) {
    if (!Number.isInteger(input.inventory)) throw new PosError("Inventory must be a whole number");
    data.inventory = input.inventory;
  }
  if (input.lowStockAt !== undefined) data.lowStockAt = input.lowStockAt == null ? null : Math.max(0, Math.trunc(input.lowStockAt));
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl?.trim() || null;
  if (input.glCode !== undefined) data.glCode = input.glCode?.trim() || null;
  if (input.incomeCategory !== undefined) data.incomeCategory = input.incomeCategory?.trim() || null;
  if (input.active !== undefined) data.active = !!input.active;
  if (input.scope !== undefined) data.locationId = input.scope === "location" ? loc.id : null;
  return data;
}

export async function createProduct(loc: LocationCtx, input: ProductInput, actorId: string): Promise<ProductDTO> {
  const data = normalizeProductInput(input, loc) as Prisma.ProductUncheckedCreateInput;
  if (data.categoryId) {
    const cat = await getPrisma().productCategory.findFirst({ where: { id: String(data.categoryId), ...orgWhere(loc.organizationId) } });
    if (!cat) throw new PosError("Category not found");
  }
  const row = await getPrisma().product.create({
    data: { ...data, organizationId: loc.organizationId, locationId: input.scope === "location" ? loc.id : null },
    include: { category: { select: { name: true } } },
  });
  void audit({ organizationId: loc.organizationId, actorId, action: "settings.update", entityType: "Product", entityId: row.id, after: row });
  return toProductDTO(row);
}

export async function updateProduct(loc: LocationCtx, id: string, input: Partial<ProductInput>, actorId: string): Promise<ProductDTO> {
  const prisma = getPrisma();
  const before = await prisma.product.findFirst({ where: { id, ...productScopeWhere(loc) } });
  if (!before) throw new PosError("Product not found", 404);
  const data = normalizeProductInput(input, loc, true);
  const row = await prisma.product.update({ where: { id }, data, include: { category: { select: { name: true } } } });
  void audit({ organizationId: loc.organizationId, actorId, action: "settings.update", entityType: "Product", entityId: id, before, after: row });
  return toProductDTO(row);
}

export async function archiveProduct(loc: LocationCtx, id: string, actorId: string, active = false): Promise<ProductDTO> {
  return updateProduct(loc, id, { active }, actorId);
}

export type ProductImportRow = { name: string; sku?: string; price: string | number; category?: string; inventory?: string | number };

export async function importProducts(loc: LocationCtx, rows: ProductImportRow[], actorId: string) {
  const prisma = getPrisma();
  const result = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };
  const categories = new Map<string, string>();
  for (const c of await prisma.productCategory.findMany({ where: orgWhere(loc.organizationId) })) categories.set(c.name.toLowerCase(), c.id);

  for (const [i, r] of rows.entries()) {
    const name = String(r.name ?? "").trim();
    const priceNum = typeof r.price === "number" ? r.price : Number(String(r.price ?? "").replace(/[$,\s]/g, ""));
    if (!name || !Number.isFinite(priceNum) || priceNum < 0) {
      result.skipped++;
      result.errors.push(`Row ${i + 1}: missing name or invalid price`);
      continue;
    }
    const priceCents = Math.round(priceNum * 100);
    const sku = String(r.sku ?? "").trim() || null;
    const invRaw = r.inventory == null || r.inventory === "" ? null : Number(r.inventory);
    const inventory = invRaw != null && Number.isFinite(invRaw) ? Math.trunc(invRaw) : null;
    let categoryId: string | null = null;
    const catName = String(r.category ?? "").trim();
    if (catName) {
      categoryId = categories.get(catName.toLowerCase()) ?? null;
      if (!categoryId) {
        const c = await createCategory(loc, { name: catName }, actorId);
        categories.set(catName.toLowerCase(), c.id);
        categoryId = c.id;
      }
    }

    const existing = sku
      ? await prisma.product.findFirst({ where: { ...productScopeWhere(loc), sku: { equals: sku, mode: "insensitive" } } })
      : await prisma.product.findFirst({ where: { ...productScopeWhere(loc), name: { equals: name, mode: "insensitive" } } });

    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          name, priceCents, sku: sku ?? existing.sku, categoryId: categoryId ?? existing.categoryId,
          ...(inventory != null ? { inventory, trackInventory: true } : {}),
        },
      });
      result.updated++;
    } else {
      await prisma.product.create({
        data: {
          organizationId: loc.organizationId, locationId: null, name, priceCents, sku, categoryId,
          inventory: inventory ?? 0, trackInventory: inventory != null,
        },
      });
      result.created++;
    }
  }
  void audit({ organizationId: loc.organizationId, actorId, action: "settings.update", entityType: "Product", entityId: "import", metadata: { ...result, locationId: loc.id } });
  return result;
}

export function productsToCsv(products: ProductDTO[]): string {
  const header = ["name", "sku", "price", "category", "taxable", "cogs", "trackInventory", "inventory", "lowStockAt", "glCode", "incomeCategory", "active", "scope"];
  const lines = products.map((p) => [
    p.name, p.sku ?? "", (p.priceCents / 100).toFixed(2), p.categoryName ?? "", p.taxable ? "yes" : "no",
    p.cogsCents != null ? (p.cogsCents / 100).toFixed(2) : "", p.trackInventory ? "yes" : "no", String(p.inventory),
    p.lowStockAt != null ? String(p.lowStockAt) : "", p.glCode ?? "", p.incomeCategory ?? "", p.active ? "yes" : "no", p.locationId ? "location" : "all",
  ]);
  return toCsv([header, ...lines]);
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/* ───────────────────────────── POS context ────────────────────────────── */

export async function getPosContext(loc: LocationCtx): Promise<PosContextDTO> {
  const [categories, products] = await Promise.all([listCategories(loc), listProducts(loc, { active: "active" })]);
  return {
    location: { id: loc.id, name: loc.name, slug: loc.slug, taxRateBps: loc.taxRateBps, currency: loc.currency, timezone: loc.timezone },
    categories,
    products,
    squareReady: squareReady(),
  };
}

export async function searchCustomers(loc: LocationCtx, q: string, limit = 8): Promise<CustomerDTO[]> {
  const s = q.trim();
  if (s.length < 2) return [];
  const prisma = getPrisma();
  const members = await prisma.member.findMany({
    where: {
      locationId: loc.id,
      OR: [
        { firstName: { contains: s, mode: "insensitive" } },
        { lastName: { contains: s, mode: "insensitive" } },
        { fullName: { contains: s, mode: "insensitive" } },
        { email: { contains: s, mode: "insensitive" } },
        { phone: { contains: s.replace(/\D/g, "") || s } },
      ],
    },
    take: limit,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true },
  });
  const credits = await Promise.all(members.map((m) => getCreditBalanceCents(m.id)));
  return members.map((m, i) => ({ ...m, creditCents: credits[i] }));
}

/* ───────────────────────────── gift card codes ────────────────────────── */

const GC_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function generateGiftCardCode(): string {
  const chars: string[] = [];
  for (let i = 0; i < 16; i++) chars.push(GC_ALPHABET[randomInt(GC_ALPHABET.length)]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

export function normalizeGiftCardCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return [0, 4, 8, 12].map((i) => s.slice(i, i + 4)).filter(Boolean).join("-");
}

function maskCode(code: string): { codeMasked: string; last4: string } {
  const last4 = code.replace(/-/g, "").slice(-4);
  return { codeMasked: `****-****-****-${last4}`, last4 };
}

/* ───────────────────────────── sales ──────────────────────────────────── */

type SaleRow = Prisma.SaleGetPayload<{ include: { lineItems: true } }>;

async function staffNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const admins = await getPrisma().admin.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, phone: true } });
  return new Map(admins.map((a) => [a.id, a.name || a.phone]));
}

function toSaleDTO(s: SaleRow, staff: Map<string, string>): SaleDTO {
  const { notes, meta } = splitNotes(s.notes);
  const refunds = meta.refunds ?? [];
  const refundedCents = s.status === "REFUNDED" || s.status === "VOID" ? s.totalCents : refunds.reduce((a, r) => a + r.amountCents, 0);
  return {
    id: s.id,
    number: s.number,
    locationId: s.locationId,
    memberId: s.memberId,
    customerName: s.customerName,
    customerEmail: s.customerEmail,
    staffId: s.staffId,
    staffName: s.staffId ? staff.get(s.staffId) ?? null : null,
    status: s.status as SaleStatus,
    paymentKind: s.paymentKind as PaymentKind,
    chargeId: s.chargeId,
    giftCardId: s.giftCardId,
    subtotalCents: s.subtotalCents,
    discountCents: s.discountCents,
    taxCents: s.taxCents,
    totalCents: s.totalCents,
    refundedCents,
    refunds,
    payment: meta.payment ?? {},
    notes,
    createdAt: s.createdAt.toISOString(),
    refundedAt: s.refundedAt?.toISOString() ?? null,
    lineItems: s.lineItems.map((li) => ({ id: li.id, productId: li.productId, description: li.description, quantity: li.quantity, unitCents: li.unitCents, totalCents: li.totalCents })),
  };
}

export async function getSale(loc: LocationCtx, id: string): Promise<SaleDTO> {
  const row = await getPrisma().sale.findFirst({ where: { id, locationId: loc.id }, include: { lineItems: true } });
  if (!row) throw new PosError("Sale not found", 404);
  return toSaleDTO(row, await staffNames([row.staffId]));
}

function parseRange(from?: string, to?: string, tz = "America/New_York"): { start: Date; end: Date } {
  // Accept YYYY-MM-DD (interpreted in the location's timezone) or ISO strings.
  const dayStart = (d: string) => zonedDateStart(d, tz);
  const start = from ? (/^\d{4}-\d{2}-\d{2}$/.test(from) ? dayStart(from) : new Date(from)) : new Date(Date.now() - 30 * 86_400_000);
  let end = to ? (/^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(dayStart(to).getTime() + 86_400_000) : new Date(to)) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new PosError("Invalid date range");
  if (end < start) end = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

/** Midnight of `yyyy-MM-dd` in the given IANA timezone. */
function zonedDateStart(day: string, tz: string): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  // offset between the tz wall clock and UTC for this instant
  const wall = formatInTimeZone(guess, tz, "yyyy-MM-dd'T'HH:mm:ss");
  const diff = new Date(`${wall}Z`).getTime() - guess.getTime();
  return new Date(guess.getTime() - diff);
}

export async function listSales(loc: LocationCtx, f: SalesListFilters, limit = 500): Promise<{ sales: SaleDTO[]; staff: StaffDTO[] }> {
  const { start, end } = parseRange(f.from, f.to, loc.timezone);
  const where: Prisma.SaleWhereInput = { locationId: loc.id, createdAt: { gte: start, lt: end } };
  if (f.staffId) where.staffId = f.staffId;
  if (f.paymentKind) where.paymentKind = f.paymentKind;
  if (f.status) where.status = f.status;
  if (f.q?.trim()) {
    const q = f.q.trim();
    const or: Prisma.SaleWhereInput[] = [
      { customerName: { contains: q, mode: "insensitive" } },
      { customerEmail: { contains: q, mode: "insensitive" } },
      { lineItems: { some: { description: { contains: q, mode: "insensitive" } } } },
    ];
    if (/^#?\d+$/.test(q)) or.push({ number: Number(q.replace("#", "")) });
    where.OR = or;
  }
  const rows = await getPrisma().sale.findMany({ where, include: { lineItems: true }, orderBy: { createdAt: "desc" }, take: limit });
  const allStaffIds = await getPrisma().sale.findMany({ where: { locationId: loc.id }, distinct: ["staffId"], select: { staffId: true } });
  const names = await staffNames([...rows.map((r) => r.staffId), ...allStaffIds.map((s) => s.staffId)]);
  return {
    sales: rows.map((r) => toSaleDTO(r, names)),
    staff: [...names.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function salesToCsv(sales: SaleDTO[], tz: string): string {
  const header = ["number", "date", "status", "payment", "customer", "email", "staff", "items", "subtotal", "discount", "tax", "total", "refunded", "notes"];
  const rows = sales.map((s) => [
    s.number, formatInTimeZone(new Date(s.createdAt), tz, "yyyy-MM-dd HH:mm"), s.status, s.paymentKind, s.customerName ?? "", s.customerEmail ?? "", s.staffName ?? "",
    s.lineItems.map((li) => `${li.quantity}× ${li.description}`).join("; "),
    (s.subtotalCents / 100).toFixed(2), (s.discountCents / 100).toFixed(2), (s.taxCents / 100).toFixed(2), (s.totalCents / 100).toFixed(2), (s.refundedCents / 100).toFixed(2), s.notes ?? "",
  ]);
  return toCsv([header, ...rows]);
}

function receiptLocation(loc: LocationFull): ReceiptLocation {
  return { ...loc, timezone: loc.timezone, currency: loc.currency };
}

/* ── create ── */

export async function createSale(loc: LocationFull, req: CreateSaleRequest, actor: { id: string }): Promise<SaleDTO> {
  const prisma = getPrisma();
  if (!Array.isArray(req.items) || req.items.length === 0) throw new PosError("Add at least one item");

  // Resolve products so prices/taxability come from the catalog, not the client.
  const productIds = [...new Set(req.items.map((i) => i.productId).filter((x): x is string => !!x))];
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds }, ...productScopeWhere(loc) } })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  const items: CartLineInput[] = req.items.map((raw) => {
    const qty = Math.trunc(Number(raw.quantity));
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw new PosError(`Invalid quantity for "${raw.description}"`);
    if (raw.productId) {
      const p = byId.get(raw.productId);
      if (!p) throw new PosError("A product in the cart no longer exists");
      if (!p.active) throw new PosError(`"${p.name}" is archived`);
      return { productId: p.id, description: p.name, quantity: qty, unitCents: p.priceCents, taxable: p.taxable, giftCard: null };
    }
    const unit = Math.round(Number(raw.unitCents));
    if (!Number.isFinite(unit) || unit < 0) throw new PosError(`Invalid amount for "${raw.description}"`);
    const description = String(raw.description ?? "").trim();
    if (!description) throw new PosError("Custom items need a description");
    if (raw.giftCard) {
      if (unit < 100) throw new PosError("Gift card amount must be at least $1");
      if (qty !== 1) throw new PosError("Sell one gift card per line");
      return { productId: null, description, quantity: 1, unitCents: unit, taxable: false, giftCard: raw.giftCard };
    }
    return { productId: null, description, quantity: qty, unitCents: unit, taxable: !!raw.taxable, giftCard: null };
  });

  // Inventory check.
  const needed = new Map<string, number>();
  for (const it of items) if (it.productId) needed.set(it.productId, (needed.get(it.productId) ?? 0) + it.quantity);
  for (const [pid, qty] of needed) {
    const p = byId.get(pid)!;
    if (p.trackInventory && p.inventory < qty) throw new PosError(`Not enough stock for "${p.name}" (have ${p.inventory}, need ${qty})`);
  }

  const discount = req.discount && req.discount.value > 0 ? { kind: req.discount.kind, value: Number(req.discount.value) } : null;
  const totals = computeSaleTotals(items, discount, loc.taxRateBps);
  if (totals.totalCents < 0) throw new PosError("Total cannot be negative");

  // Customer.
  let memberId: string | null = null;
  let customerName = (req.customer?.name ?? "").trim() || null;
  let customerEmail = (req.customer?.email ?? "").trim().toLowerCase() || null;
  if (req.customer?.memberId) {
    const m = await prisma.member.findFirst({ where: { id: req.customer.memberId, locationId: loc.id }, select: { id: true, firstName: true, lastName: true, email: true } });
    if (!m) throw new PosError("Member not found at this location");
    memberId = m.id;
    customerName = customerName ?? `${m.firstName} ${m.lastName}`.trim();
    customerEmail = customerEmail ?? (m.email || null);
  }

  // Payment pre-validation.
  const payment = req.payment;
  const paymentMeta: SalePaymentMeta = {};
  let giftCard: { id: string; code: string; balanceCents: number } | null = null;
  switch (payment?.kind) {
    case "CASH": {
      if (payment.tenderedCents != null) {
        const t = Math.round(Number(payment.tenderedCents));
        if (!Number.isFinite(t) || t < totals.totalCents) throw new PosError("Cash tendered is less than the total");
        paymentMeta.tenderedCents = t;
        paymentMeta.changeCents = t - totals.totalCents;
      }
      break;
    }
    case "OTHER": {
      if (payment.reference?.trim()) paymentMeta.reference = payment.reference.trim().slice(0, 120);
      break;
    }
    case "CREDIT": {
      if (!memberId) throw new PosError("Member credit requires a member");
      const bal = await getCreditBalanceCents(memberId);
      if (bal < totals.totalCents) throw new PosError(`Insufficient member credit (balance ${(bal / 100).toFixed(2)})`);
      break;
    }
    case "GIFT_CARD": {
      const code = normalizeGiftCardCode(payment.code ?? "");
      const gc = await prisma.giftCard.findUnique({ where: { code } });
      if (!gc || (gc.organizationId ?? null) !== (loc.organizationId ?? null)) throw new PosError("Gift card not found");
      if (gc.status !== "ACTIVE") throw new PosError(`Gift card is ${gc.status.toLowerCase()}`);
      if (gc.expiresAt && gc.expiresAt < new Date()) throw new PosError("Gift card has expired");
      if (gc.balanceCents < totals.totalCents) throw new PosError(`Gift card balance (${(gc.balanceCents / 100).toFixed(2)}) doesn't cover the total`);
      giftCard = { id: gc.id, code: gc.code, balanceCents: gc.balanceCents };
      paymentMeta.giftCardLast4 = maskCode(gc.code).last4;
      break;
    }
    case "CARD": {
      if (!squareReady()) throw new PosError("Card payments require Square — configure SQUARE_* env", 409);
      if (!payment.sourceId) throw new PosError("Missing card token");
      if (totals.totalCents <= 0) throw new PosError("Card payments require a positive total");
      break;
    }
    default:
      throw new PosError("Choose a payment method");
  }

  // External charge first (can't be rolled back by the DB transaction).
  let chargeId: string | null = null;
  if (payment.kind === "CARD") {
    const idempotencyKey = `pos_${loc.id}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const charge = await prisma.charge.create({
      data: { organizationId: loc.organizationId, locationId: loc.id, memberId, amountCents: totals.totalCents, currency: loc.currency, status: "PENDING", idempotencyKey },
    });
    try {
      const sq = await squareCreatePayment({ amountCents: totals.totalCents, currency: loc.currency, sourceId: payment.sourceId, idempotencyKey, note: `POS sale at ${loc.name}` });
      await prisma.charge.update({ where: { id: charge.id }, data: { status: sq.status === "COMPLETED" ? "SUCCEEDED" : sq.status, squarePaymentId: sq.id } });
      if (sq.status !== "COMPLETED" && sq.status !== "APPROVED") throw new PosError(`Card payment ${sq.status.toLowerCase()}`, 402);
    } catch (e) {
      await prisma.charge.update({ where: { id: charge.id }, data: { status: "FAILED", failureReason: e instanceof Error ? e.message.slice(0, 500) : "failed" } }).catch(() => {});
      throw e instanceof PosError ? e : new PosError(`Card payment failed: ${e instanceof Error ? e.message : "unknown error"}`, 402);
    }
    chargeId = charge.id;
  }

  // Everything else atomically.
  const soldGiftCards: Array<{ code: string; amountCents: number; recipientEmail: string | null; recipientName: string | null }> = [];
  const sale = await prisma.$transaction(async (tx) => {
    // Sold gift cards get created first so their code can be in the line description.
    const lineData: Prisma.SaleLineItemCreateWithoutSaleInput[] = [];
    for (const [i, it] of items.entries()) {
      let description = it.description;
      if (it.giftCard) {
        let code = generateGiftCardCode();
        for (let tries = 0; tries < 5 && (await tx.giftCard.findUnique({ where: { code } })); tries++) code = generateGiftCardCode();
        await tx.giftCard.create({
          data: {
            organizationId: loc.organizationId, code, initialCents: it.unitCents, balanceCents: it.unitCents, purchaserMemberId: memberId,
            recipientName: it.giftCard.recipientName?.trim() || null, recipientEmail: it.giftCard.recipientEmail?.trim().toLowerCase() || null, status: "ACTIVE",
          },
        });
        soldGiftCards.push({ code, amountCents: it.unitCents, recipientEmail: it.giftCard.recipientEmail?.trim() || null, recipientName: it.giftCard.recipientName?.trim() || null });
        description = `Gift card ${maskCode(code).codeMasked}`;
      }
      lineData.push({ description, quantity: it.quantity, unitCents: it.unitCents, totalCents: totals.lines[i].totalCents, ...(it.productId ? { product: { connect: { id: it.productId } } } : {}) });
    }

    for (const [pid, qty] of needed) {
      const p = byId.get(pid)!;
      if (p.trackInventory) await tx.product.update({ where: { id: pid }, data: { inventory: { decrement: qty } } });
    }

    if (giftCard) {
      const remaining = giftCard.balanceCents - totals.totalCents;
      await tx.giftCard.update({ where: { id: giftCard.id }, data: { balanceCents: remaining, status: remaining <= 0 ? "DEPLETED" : "ACTIVE" } });
    }

    return tx.sale.create({
      data: {
        organizationId: loc.organizationId,
        locationId: loc.id,
        memberId,
        customerName,
        customerEmail,
        staffId: actor.id,
        status: "PAID",
        paymentKind: payment.kind,
        chargeId,
        giftCardId: giftCard?.id ?? null,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        notes: joinNotes(req.notes, { payment: paymentMeta }),
        lineItems: { create: lineData },
      },
      include: { lineItems: true },
    });
  });

  // Member credit debit (ledger row; outside tx because addCredit uses the global client).
  if (payment.kind === "CREDIT" && memberId) {
    try {
      await addCredit({ memberId, amountCents: -totals.totalCents, type: "ADJUSTMENT", reason: `POS sale #${sale.number}`, actorId: actor.id });
    } catch (e) {
      console.error("[pos] credit debit failed for sale", sale.id, e);
    }
  }

  const dto = toSaleDTO(sale, await staffNames([sale.staffId]));

  void audit({
    organizationId: loc.organizationId, actorId: actor.id, action: "billing.charge", entityType: "Sale", entityId: sale.id,
    after: { number: sale.number, totalCents: sale.totalCents, paymentKind: sale.paymentKind, memberId, chargeId, giftCardId: giftCard?.id ?? null },
    metadata: { locationId: loc.id, soldGiftCards: soldGiftCards.map((g) => maskCode(g.code).codeMasked) },
  });
  if (memberId) {
    await emitMemberEvent("sale.completed", {
      memberId, locationId: loc.id, organizationId: loc.organizationId, actorAdminId: actor.id,
      vars: { amount: (sale.totalCents / 100).toFixed(2), sale_number: sale.number, payment_kind: sale.paymentKind },
      refs: { saleId: sale.id, ...(chargeId ? { chargeId } : {}) },
    });
  }
  if (req.sendReceipt !== false && dto.customerEmail) {
    await sendSaleReceipt(dto, receiptLocation(loc));
  }
  // Gift card delivery to the recipient (full code — it's their card).
  for (const g of soldGiftCards) {
    if (g.recipientEmail) {
      const { sendEmail } = await import("@/lib/notify");
      await sendEmail({
        to: g.recipientEmail,
        subject: `You've received a ${loc.businessName || loc.name} gift card`,
        html: `<p>${g.recipientName ? `Hi ${g.recipientName},` : "Hi,"}</p><p>${customerName ? `${customerName} sent` : "You've received"} a gift card worth <strong>$${(g.amountCents / 100).toFixed(2)}</strong> for ${loc.businessName || loc.name}.</p><p style="font-size:20px;letter-spacing:2px;font-family:monospace;"><strong>${g.code}</strong></p><p>Show this code at the counter to redeem.</p>`,
      }).catch(() => {});
    }
  }
  return dto;
}

/* ── refund / void ── */

export async function refundSale(
  loc: LocationFull,
  saleId: string,
  input: { lineItemIds?: string[]; reason?: string | null; mode?: "refund" | "void" },
  actor: { id: string },
): Promise<SaleDTO> {
  const prisma = getPrisma();
  const sale = await prisma.sale.findFirst({ where: { id: saleId, locationId: loc.id }, include: { lineItems: true } });
  if (!sale) throw new PosError("Sale not found", 404);
  if (sale.status === "REFUNDED" || sale.status === "VOID") throw new PosError(`Sale is already ${sale.status.toLowerCase()}`);
  if (sale.status !== "PAID") throw new PosError("Only paid sales can be refunded");

  const mode: "refund" | "void" = input.mode ?? "refund";
  const isVoid = mode === "void";
  const { notes, meta } = splitNotes(sale.notes);
  const priorRefunds = meta.refunds ?? [];
  const alreadyRefunded = priorRefunds.reduce((a, r) => a + r.amountCents, 0);
  const alreadyRefundedLineIds = new Set(priorRefunds.flatMap((r) => r.lineItemIds));

  if (isVoid) {
    const saleDay = formatInTimeZone(sale.createdAt, loc.timezone, "yyyy-MM-dd");
    const today = formatInTimeZone(new Date(), loc.timezone, "yyyy-MM-dd");
    if (saleDay !== today) throw new PosError("Only same-day sales can be voided — refund instead");
    if (alreadyRefunded > 0) throw new PosError("Sale has partial refunds — refund the remainder instead");
  }

  // Which lines, and how much.
  const selected = input.lineItemIds?.length ? sale.lineItems.filter((li) => input.lineItemIds!.includes(li.id)) : sale.lineItems;
  const partial = !isVoid && !!input.lineItemIds?.length && selected.length < sale.lineItems.length;
  if (!selected.length) throw new PosError("Select at least one item");
  for (const li of selected) if (alreadyRefundedLineIds.has(li.id)) throw new PosError(`"${li.description}" was already refunded`);

  let amountCents: number;
  if (partial) {
    const share = sale.subtotalCents > 0 ? selected.reduce((a, li) => a + li.totalCents, 0) / sale.subtotalCents : 0;
    amountCents = Math.round(sale.totalCents * share);
  } else {
    amountCents = sale.totalCents - alreadyRefunded;
  }
  amountCents = Math.max(0, Math.min(amountCents, sale.totalCents - alreadyRefunded));
  const fullyRefunded = !partial || alreadyRefunded + amountCents >= sale.totalCents;

  // Reverse payment.
  if (amountCents > 0) {
    switch (sale.paymentKind as PaymentKind) {
      case "CARD": {
        if (!sale.chargeId) break;
        const charge = await prisma.charge.findUnique({ where: { id: sale.chargeId } });
        if (!charge?.squarePaymentId) throw new PosError("Card charge has no Square payment id — cannot refund automatically");
        if (!squareReady()) throw new PosError("Square is not configured — card refunds unavailable", 409);
        const idempotencyKey = `pos_refund_${sale.id}_${Date.now()}`;
        const sq = await squareCreateRefund({ paymentId: charge.squarePaymentId, amountCents, currency: loc.currency, idempotencyKey, reason: input.reason ?? `POS sale #${sale.number} ${mode}` });
        await prisma.refund.create({ data: { chargeId: charge.id, amountCents, reason: input.reason ?? null, squareRefundId: sq.id, status: sq.status, refundedById: actor.id } });
        await prisma.charge.update({ where: { id: charge.id }, data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
        break;
      }
      case "CREDIT": {
        if (sale.memberId) await addCredit({ memberId: sale.memberId, amountCents, type: "REFUND_AS_CREDIT", reason: `${isVoid ? "Void" : "Refund"} of POS sale #${sale.number}`, actorId: actor.id });
        break;
      }
      case "GIFT_CARD": {
        if (sale.giftCardId) {
          const gc = await prisma.giftCard.findUnique({ where: { id: sale.giftCardId } });
          if (gc && gc.status !== "VOID") await prisma.giftCard.update({ where: { id: gc.id }, data: { balanceCents: gc.balanceCents + amountCents, status: "ACTIVE" } });
        }
        break;
      }
      default:
        break; // CASH / OTHER: record only
    }
  }

  // Restore inventory for refunded product lines.
  for (const li of selected) {
    if (!li.productId) continue;
    const p = await prisma.product.findUnique({ where: { id: li.productId }, select: { trackInventory: true } });
    if (p?.trackInventory) await prisma.product.update({ where: { id: li.productId }, data: { inventory: { increment: li.quantity } } });
  }

  const record: SaleRefundRecord = { amountCents, at: new Date().toISOString(), reason: input.reason?.trim() || null, lineItemIds: selected.map((l) => l.id), kind: mode };
  const updated = await prisma.sale.update({
    where: { id: sale.id },
    data: {
      status: isVoid ? "VOID" : fullyRefunded ? "REFUNDED" : "PAID",
      refundedAt: fullyRefunded || isVoid ? new Date() : sale.refundedAt,
      notes: joinNotes(notes, { ...meta, refunds: [...priorRefunds, record] }),
    },
    include: { lineItems: true },
  });

  void audit({
    organizationId: loc.organizationId, actorId: actor.id, action: "billing.refund", entityType: "Sale", entityId: sale.id,
    before: { status: sale.status }, after: { status: updated.status, amountCents, lineItemIds: record.lineItemIds },
    metadata: { mode, reason: record.reason, paymentKind: sale.paymentKind, locationId: loc.id },
  });
  if (sale.memberId) {
    await emitMemberEvent("payment.refunded", {
      memberId: sale.memberId, locationId: loc.id, organizationId: loc.organizationId, actorAdminId: actor.id,
      vars: { amount: (amountCents / 100).toFixed(2), sale_number: sale.number }, refs: { saleId: sale.id, ...(sale.chargeId ? { chargeId: sale.chargeId } : {}) },
    });
  }
  const dto = toSaleDTO(updated, await staffNames([updated.staffId]));
  if (dto.customerEmail) await sendSaleReceipt(dto, receiptLocation(loc));
  return dto;
}

export async function resendReceipt(loc: LocationFull, saleId: string, to?: string | null): Promise<{ sent: boolean; to: string | null }> {
  const dto = await getSale(loc, saleId);
  const recipient = (to ?? dto.customerEmail ?? "").trim() || null;
  if (!recipient) throw new PosError("No email on this sale — enter one to send the receipt");
  const sent = await sendSaleReceipt(dto, receiptLocation(loc), recipient);
  if (sent && recipient !== dto.customerEmail && !dto.customerEmail) {
    await getPrisma().sale.update({ where: { id: saleId }, data: { customerEmail: recipient.toLowerCase() } });
  }
  return { sent, to: recipient };
}

/* ───────────────────────────── gift cards ─────────────────────────────── */

type GiftCardRow = Prisma.GiftCardGetPayload<Record<string, never>>;

async function toGiftCardDTOs(rows: GiftCardRow[]): Promise<GiftCardDTO[]> {
  const purchaserIds = [...new Set(rows.map((r) => r.purchaserMemberId).filter((x): x is string => !!x))];
  const members = purchaserIds.length
    ? await getPrisma().member.findMany({ where: { id: { in: purchaserIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const names = new Map(members.map((m) => [m.id, `${m.firstName} ${m.lastName}`.trim()]));
  return rows.map((g) => ({
    id: g.id,
    ...maskCode(g.code),
    initialCents: g.initialCents,
    balanceCents: g.balanceCents,
    purchaserMemberId: g.purchaserMemberId,
    purchaserName: g.purchaserMemberId ? names.get(g.purchaserMemberId) ?? null : null,
    recipientName: g.recipientName,
    recipientEmail: g.recipientEmail,
    status: g.status as GiftCardDTO["status"],
    expiresAt: g.expiresAt?.toISOString() ?? null,
    createdAt: g.createdAt.toISOString(),
  }));
}

export async function listGiftCards(loc: LocationCtx, opts: { q?: string; status?: string } = {}): Promise<GiftCardDTO[]> {
  const where: Prisma.GiftCardWhereInput = { ...orgWhere(loc.organizationId) };
  if (opts.status && opts.status !== "ALL") where.status = opts.status;
  if (opts.q?.trim()) {
    const q = opts.q.trim();
    where.OR = [
      { recipientName: { contains: q, mode: "insensitive" } },
      { recipientEmail: { contains: q, mode: "insensitive" } },
      { code: { endsWith: q.toUpperCase().replace(/[^A-Z0-9]/g, "") } },
    ];
  }
  const rows = await getPrisma().giftCard.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 });
  return toGiftCardDTOs(rows);
}

export async function lookupGiftCard(loc: LocationCtx, rawCode: string): Promise<GiftCardLookupDTO> {
  const code = normalizeGiftCardCode(rawCode);
  const gc = await getPrisma().giftCard.findUnique({ where: { code } });
  if (!gc || (gc.organizationId ?? null) !== (loc.organizationId ?? null)) throw new PosError("Gift card not found", 404);
  const [dto] = await toGiftCardDTOs([gc]);
  let reason: string | null = null;
  if (gc.status !== "ACTIVE") reason = `Card is ${gc.status.toLowerCase()}`;
  else if (gc.expiresAt && gc.expiresAt < new Date()) reason = "Card has expired";
  else if (gc.balanceCents <= 0) reason = "No balance remaining";
  return { ...dto, usable: reason === null, reason };
}

export async function issueGiftCard(
  loc: LocationCtx,
  input: { amountCents: number; recipientName?: string | null; recipientEmail?: string | null; purchaserMemberId?: string | null; expiresAt?: string | null; reason?: string | null },
  actorId: string,
): Promise<GiftCardDTO & { code: string }> {
  const amount = Math.round(Number(input.amountCents));
  if (!Number.isFinite(amount) || amount < 100) throw new PosError("Amount must be at least $1");
  const prisma = getPrisma();
  let code = generateGiftCardCode();
  for (let tries = 0; tries < 5 && (await prisma.giftCard.findUnique({ where: { code } })); tries++) code = generateGiftCardCode();
  const row = await prisma.giftCard.create({
    data: {
      organizationId: loc.organizationId, code, initialCents: amount, balanceCents: amount,
      purchaserMemberId: input.purchaserMemberId || null, recipientName: input.recipientName?.trim() || null, recipientEmail: input.recipientEmail?.trim().toLowerCase() || null,
      status: "ACTIVE", expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    },
  });
  void audit({
    organizationId: loc.organizationId, actorId, action: "billing.credit-add", entityType: "GiftCard", entityId: row.id,
    after: { amountCents: amount, codeMasked: maskCode(code).codeMasked, recipientEmail: row.recipientEmail }, metadata: { reason: input.reason ?? "Issued manually (comp)", locationId: loc.id },
  });
  const [dto] = await toGiftCardDTOs([row]);
  return { ...dto, code };
}

export async function adjustGiftCard(loc: LocationCtx, id: string, input: { deltaCents: number; reason: string }, actorId: string): Promise<GiftCardDTO> {
  const delta = Math.round(Number(input.deltaCents));
  if (!Number.isFinite(delta) || delta === 0) throw new PosError("Enter a non-zero adjustment");
  if (!input.reason?.trim()) throw new PosError("A reason is required");
  const prisma = getPrisma();
  const gc = await prisma.giftCard.findFirst({ where: { id, ...orgWhere(loc.organizationId) } });
  if (!gc) throw new PosError("Gift card not found", 404);
  if (gc.status === "VOID") throw new PosError("Gift card is void");
  const next = gc.balanceCents + delta;
  if (next < 0) throw new PosError("Balance cannot go below zero");
  const row = await prisma.giftCard.update({ where: { id }, data: { balanceCents: next, status: next === 0 ? "DEPLETED" : "ACTIVE" } });
  void audit({
    organizationId: loc.organizationId, actorId, action: delta > 0 ? "billing.credit-add" : "billing.credit-spend", entityType: "GiftCard", entityId: id,
    before: { balanceCents: gc.balanceCents, status: gc.status }, after: { balanceCents: row.balanceCents, status: row.status },
    metadata: { deltaCents: delta, reason: input.reason.trim(), locationId: loc.id },
  });
  const [dto] = await toGiftCardDTOs([row]);
  return dto;
}

export async function voidGiftCard(loc: LocationCtx, id: string, reason: string | null, actorId: string): Promise<GiftCardDTO> {
  const prisma = getPrisma();
  const gc = await prisma.giftCard.findFirst({ where: { id, ...orgWhere(loc.organizationId) } });
  if (!gc) throw new PosError("Gift card not found", 404);
  const row = await prisma.giftCard.update({ where: { id }, data: { status: "VOID" } });
  void audit({
    organizationId: loc.organizationId, actorId, action: "billing.credit-spend", entityType: "GiftCard", entityId: id,
    before: { status: gc.status, balanceCents: gc.balanceCents }, after: { status: "VOID" }, metadata: { reason, voided: true, locationId: loc.id },
  });
  const [dto] = await toGiftCardDTOs([row]);
  return dto;
}

/* ───────────────────────────── reporting ──────────────────────────────── */

type ReportSale = Prisma.SaleGetPayload<{ include: { lineItems: { include: { product: { select: { name: true; cogsCents: true; glCode: true; incomeCategory: true; category: { select: { name: true } } } } } } } }>;

async function loadReportSales(loc: LocationCtx, from?: string, to?: string): Promise<{ sales: ReportSale[]; start: Date; end: Date }> {
  const { start, end } = parseRange(from, to, loc.timezone);
  const sales = await getPrisma().sale.findMany({
    where: { locationId: loc.id, createdAt: { gte: start, lt: end }, status: { in: ["PAID", "REFUNDED"] } },
    include: { lineItems: { include: { product: { select: { name: true, cogsCents: true, glCode: true, incomeCategory: true, category: { select: { name: true } } } } } } },
    orderBy: { createdAt: "asc" },
  });
  return { sales, start, end };
}

function refundedCentsOf(s: ReportSale): number {
  if (s.status === "REFUNDED" || s.status === "VOID") return s.totalCents;
  return (splitNotes(s.notes).meta.refunds ?? []).reduce((a, r) => a + r.amountCents, 0);
}

/** Net share of the sale attributable to a line (after discount, before tax). */
function lineNetCents(s: ReportSale, li: ReportSale["lineItems"][number]): number {
  if (s.subtotalCents <= 0) return 0;
  return Math.round(li.totalCents * ((s.subtotalCents - s.discountCents) / s.subtotalCents));
}

export async function salesSummary(loc: LocationCtx, from?: string, to?: string): Promise<SalesSummaryDTO> {
  const { sales, start, end } = await loadReportSales(loc, from, to);
  const totals = { count: 0, grossCents: 0, discountCents: 0, taxCents: 0, refundedCents: 0, netCents: 0 };
  const byIncome = new Map<string, { netCents: number; count: number }>();
  const byGl = new Map<string, { netCents: number; count: number }>();
  const byKind = new Map<string, { netCents: number; count: number }>();
  const bump = (m: Map<string, { netCents: number; count: number }>, k: string, cents: number) => {
    const cur = m.get(k) ?? { netCents: 0, count: 0 };
    cur.netCents += cents;
    cur.count += 1;
    m.set(k, cur);
  };
  for (const s of sales) {
    const refunded = refundedCentsOf(s);
    const factor = s.totalCents > 0 ? (s.totalCents - refunded) / s.totalCents : 0;
    totals.count++;
    totals.grossCents += s.subtotalCents;
    totals.discountCents += s.discountCents;
    totals.taxCents += Math.round(s.taxCents * factor);
    totals.refundedCents += refunded;
    totals.netCents += s.totalCents - refunded;
    bump(byKind, s.paymentKind, s.totalCents - refunded);
    for (const li of s.lineItems) {
      const net = Math.round(lineNetCents(s, li) * factor);
      const isGift = !li.productId && /^Gift card/i.test(li.description);
      bump(byIncome, li.product?.incomeCategory || (isGift ? "Gift cards" : li.productId ? "Uncategorized" : "Custom items"), net);
      bump(byGl, li.product?.glCode || (isGift ? "GIFT_CARD" : "UNASSIGNED"), net);
    }
  }
  const sortDesc = <T extends { netCents: number }>(a: T[]) => a.sort((x, y) => y.netCents - x.netCents);
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    totals,
    byIncomeCategory: sortDesc([...byIncome.entries()].map(([incomeCategory, v]) => ({ incomeCategory, ...v }))),
    byGlCode: sortDesc([...byGl.entries()].map(([glCode, v]) => ({ glCode, ...v }))),
    byPaymentKind: sortDesc([...byKind.entries()].map(([paymentKind, v]) => ({ paymentKind: paymentKind as PaymentKind, ...v }))),
  };
}

export async function salesReport(loc: LocationCtx, from?: string, to?: string): Promise<SalesReportDTO> {
  const { sales, start, end } = await loadReportSales(loc, from, to);
  const staff = await staffNames(sales.map((s) => s.staffId));

  const kpis = { revenueCents: 0, cogsCents: 0, grossProfitCents: 0, taxCents: 0, discountCents: 0, refundedCents: 0, saleCount: 0, avgSaleCents: 0 };
  const byDay = new Map<string, { revenueCents: number; count: number }>();
  const byProduct = new Map<string, SalesReportDTO["byProduct"][number]>();
  const byCategory = new Map<string, { quantity: number; revenueCents: number }>();
  const byKind = new Map<string, { count: number; revenueCents: number }>();
  const byStaff = new Map<string, { count: number; revenueCents: number }>();

  // Seed every day in range so the chart has no gaps.
  for (let t = start.getTime(); t < end.getTime(); t += 86_400_000) byDay.set(formatInTimeZone(new Date(t), loc.timezone, "yyyy-MM-dd"), { revenueCents: 0, count: 0 });

  for (const s of sales) {
    const refunded = refundedCentsOf(s);
    const factor = s.totalCents > 0 ? (s.totalCents - refunded) / s.totalCents : 0;
    const netRevenue = Math.round((s.subtotalCents - s.discountCents) * factor); // excludes tax
    kpis.saleCount++;
    kpis.revenueCents += netRevenue;
    kpis.taxCents += Math.round(s.taxCents * factor);
    kpis.discountCents += s.discountCents;
    kpis.refundedCents += refunded;

    const day = formatInTimeZone(s.createdAt, loc.timezone, "yyyy-MM-dd");
    const d = byDay.get(day) ?? { revenueCents: 0, count: 0 };
    d.revenueCents += netRevenue;
    d.count++;
    byDay.set(day, d);

    const k = byKind.get(s.paymentKind) ?? { count: 0, revenueCents: 0 };
    k.count++;
    k.revenueCents += netRevenue;
    byKind.set(s.paymentKind, k);

    const sk = s.staffId ?? "";
    const st = byStaff.get(sk) ?? { count: 0, revenueCents: 0 };
    st.count++;
    st.revenueCents += netRevenue;
    byStaff.set(sk, st);

    for (const li of s.lineItems) {
      const net = Math.round(lineNetCents(s, li) * factor);
      const qty = Math.round(li.quantity * factor);
      const cogs = li.product?.cogsCents != null ? Math.round(li.product.cogsCents * li.quantity * factor) : 0;
      kpis.cogsCents += cogs;
      const pk = li.productId ?? `custom:${li.description.replace(/\s\*{4}.*$/, "")}`;
      const p = byProduct.get(pk) ?? { productId: li.productId, name: li.product?.name ?? li.description.replace(/\s\*{4}.*$/, ""), quantity: 0, revenueCents: 0, cogsCents: 0 };
      p.quantity += qty;
      p.revenueCents += net;
      p.cogsCents += cogs;
      byProduct.set(pk, p);
      const cname = li.product?.category?.name ?? (li.productId ? "Uncategorized" : /^Gift card/i.test(li.description) ? "Gift cards" : "Custom items");
      const c = byCategory.get(cname) ?? { quantity: 0, revenueCents: 0 };
      c.quantity += qty;
      c.revenueCents += net;
      byCategory.set(cname, c);
    }
  }
  kpis.grossProfitCents = kpis.revenueCents - kpis.cogsCents;
  kpis.avgSaleCents = kpis.saleCount ? Math.round(kpis.revenueCents / kpis.saleCount) : 0;

  const lowInventory = (await listProducts(loc, { active: "active", lowStock: true })).map((p) => ({ id: p.id, name: p.name, sku: p.sku, inventory: p.inventory, lowStockAt: p.lowStockAt }));

  return {
    from: start.toISOString(),
    to: end.toISOString(),
    kpis,
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
    byProduct: [...byProduct.values()].sort((a, b) => b.revenueCents - a.revenueCents),
    byCategory: [...byCategory.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenueCents - a.revenueCents),
    byPaymentKind: [...byKind.entries()].map(([paymentKind, v]) => ({ paymentKind: paymentKind as PaymentKind, ...v })).sort((a, b) => b.revenueCents - a.revenueCents),
    byStaff: [...byStaff.entries()].map(([staffId, v]) => ({ staffId: staffId || null, name: staffId ? staff.get(staffId) ?? "Unknown" : "Unknown", ...v })).sort((a, b) => b.revenueCents - a.revenueCents),
    lowInventory,
  };
}

export function reportToCsv(r: SalesReportDTO): string {
  const money = (c: number) => (c / 100).toFixed(2);
  const rows: Array<Array<string | number>> = [];
  rows.push(["section", "key", "quantity/count", "revenue", "cogs"]);
  rows.push(["kpi", "revenue", r.kpis.saleCount, money(r.kpis.revenueCents), money(r.kpis.cogsCents)]);
  rows.push(["kpi", "gross_profit", "", money(r.kpis.grossProfitCents), ""]);
  rows.push(["kpi", "tax_collected", "", money(r.kpis.taxCents), ""]);
  rows.push(["kpi", "discounts", "", money(r.kpis.discountCents), ""]);
  rows.push(["kpi", "refunds", "", money(r.kpis.refundedCents), ""]);
  rows.push(["kpi", "avg_sale", "", money(r.kpis.avgSaleCents), ""]);
  for (const d of r.byDay) rows.push(["day", d.day, d.count, money(d.revenueCents), ""]);
  for (const p of r.byProduct) rows.push(["product", p.name, p.quantity, money(p.revenueCents), money(p.cogsCents)]);
  for (const c of r.byCategory) rows.push(["category", c.name, c.quantity, money(c.revenueCents), ""]);
  for (const k of r.byPaymentKind) rows.push(["payment", k.paymentKind, k.count, money(k.revenueCents), ""]);
  for (const s of r.byStaff) rows.push(["staff", s.name, s.count, money(s.revenueCents), ""]);
  for (const l of r.lowInventory) rows.push(["low_inventory", l.name, l.inventory, "", ""]);
  return toCsv(rows);
}
