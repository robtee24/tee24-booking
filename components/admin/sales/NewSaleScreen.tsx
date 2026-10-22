// components/admin/sales/NewSaleScreen.tsx
"use client";

import Link from "next/link";
import React from "react";
import {
  Banknote, CheckCircle2, CreditCard, Gift, Minus, Package, Plus, Printer, Search, ShoppingCart, Tag, User, Wallet, X,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Textarea, formatMoney, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { CardSlot } from "./CardSlot";
import { posFetch, qs } from "./api";
import { centsToDollarsInput, computeSaleTotals, lineTotal, parseDollarsToCents } from "./pos-math";
import type { CartLineInput, CreateSaleRequest, CustomerDTO, DiscountInput, GiftCardLookupDTO, PaymentInput, PaymentKind, PosContextDTO, ProductDTO, SaleDTO } from "./types";
import { PAYMENT_KIND_LABELS } from "./types";

type CartLine = CartLineInput & { key: string; product?: ProductDTO };

type CustomerState =
  | { kind: "none" }
  | { kind: "member"; member: CustomerDTO }
  | { kind: "walkin"; name: string; email: string };

const PAYMENT_ORDER: PaymentKind[] = ["CASH", "OTHER", "CREDIT", "GIFT_CARD", "CARD"];
const PAYMENT_ICONS: Record<PaymentKind, React.ReactNode> = {
  CASH: <Banknote className="h-4 w-4" />,
  OTHER: <Printer className="h-4 w-4" />,
  CREDIT: <Wallet className="h-4 w-4" />,
  GIFT_CARD: <Gift className="h-4 w-4" />,
  CARD: <CreditCard className="h-4 w-4" />,
};

export function NewSaleScreen({ slug }: { slug: string }) {
  const { toast } = useToast();
  const [ctx, setCtx] = React.useState<PosContextDTO | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState<string>("all");
  const [cart, setCart] = React.useState<CartLine[]>([]);
  const [discount, setDiscount] = React.useState<{ kind: "amount" | "percent"; value: string }>({ kind: "amount", value: "" });
  const [customer, setCustomer] = React.useState<CustomerState>({ kind: "none" });
  const [notes, setNotes] = React.useState("");
  const [payment, setPayment] = React.useState<PaymentKind>("CASH");
  const [tendered, setTendered] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [giftCode, setGiftCode] = React.useState("");
  const [giftLookup, setGiftLookup] = React.useState<GiftCardLookupDTO | null>(null);
  const [giftLookupError, setGiftLookupError] = React.useState<string | null>(null);
  const [sourceId, setSourceId] = React.useState<string | null>(null);
  const [sendReceipt, setSendReceipt] = React.useState(true);

  const [customOpen, setCustomOpen] = React.useState(false);
  const [giftOpen, setGiftOpen] = React.useState(false);
  const [cartOpen, setCartOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [receipt, setReceipt] = React.useState<SaleDTO | null>(null);

  const load = React.useCallback(async () => {
    try {
      setCtx(await posFetch<PosContextDTO>(`/api/admin/sales/context${qs({ locationSlug: slug })}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load products");
    }
  }, [slug]);

  React.useEffect(() => { void load(); }, [load]);

  const taxRateBps = ctx?.location.taxRateBps ?? 0;
  const currency = ctx?.location.currency ?? "USD";

  const discountInput: DiscountInput = React.useMemo(() => {
    if (!discount.value.trim()) return null;
    if (discount.kind === "percent") {
      const n = Number(discount.value);
      return Number.isFinite(n) && n > 0 ? { kind: "percent", value: Math.min(n, 100) } : null;
    }
    const cents = parseDollarsToCents(discount.value);
    return cents && cents > 0 ? { kind: "amount", value: cents } : null;
  }, [discount]);

  const totals = React.useMemo(() => computeSaleTotals(cart, discountInput, taxRateBps), [cart, discountInput, taxRateBps]);
  const itemCount = cart.reduce((n, l) => n + l.quantity, 0);

  /* ── cart ops ── */
  function addProduct(p: ProductDTO) {
    setCart((c) => {
      const i = c.findIndex((l) => l.productId === p.id);
      if (i >= 0) {
        if (p.trackInventory && c[i].quantity + 1 > p.inventory) {
          toast({ tone: "error", title: `Only ${p.inventory} in stock` });
          return c;
        }
        const next = [...c];
        next[i] = { ...next[i], quantity: next[i].quantity + 1 };
        return next;
      }
      if (p.trackInventory && p.inventory < 1) {
        toast({ tone: "error", title: `${p.name} is out of stock` });
        return c;
      }
      return [...c, { key: `p-${p.id}`, productId: p.id, description: p.name, quantity: 1, unitCents: p.priceCents, taxable: p.taxable, product: p }];
    });
  }
  function changeQty(key: string, delta: number) {
    setCart((c) =>
      c
        .map((l) => {
          if (l.key !== key) return l;
          const q = l.quantity + delta;
          if (l.product?.trackInventory && q > l.product.inventory) {
            toast({ tone: "error", title: `Only ${l.product.inventory} in stock` });
            return l;
          }
          return { ...l, quantity: q };
        })
        .filter((l) => l.quantity > 0),
    );
  }
  function removeLine(key: string) { setCart((c) => c.filter((l) => l.key !== key)); }
  function addCustom(line: { description: string; unitCents: number; quantity: number; taxable: boolean }) {
    setCart((c) => [...c, { key: `c-${Date.now()}`, productId: null, ...line }]);
  }
  function addGiftCard(g: { amountCents: number; recipientName: string; recipientEmail: string }) {
    setCart((c) => [
      ...c,
      { key: `g-${Date.now()}`, productId: null, description: `Gift card${g.recipientName ? ` for ${g.recipientName}` : ""}`, quantity: 1, unitCents: g.amountCents, taxable: false, giftCard: { recipientName: g.recipientName || null, recipientEmail: g.recipientEmail || null } },
    ]);
  }

  function resetSale() {
    setCart([]); setDiscount({ kind: "amount", value: "" }); setCustomer({ kind: "none" }); setNotes("");
    setPayment("CASH"); setTendered(""); setReference(""); setGiftCode(""); setGiftLookup(null); setGiftLookupError(null); setSourceId(null);
    setSendReceipt(true); setReceipt(null); setCartOpen(false);
    void load();
  }

  /* ── gift card lookup ── */
  async function lookupGift() {
    setGiftLookupError(null);
    setGiftLookup(null);
    try {
      const r = await posFetch<{ giftCard: GiftCardLookupDTO }>(`/api/admin/gift-cards/lookup${qs({ locationSlug: slug, code: giftCode })}`);
      setGiftLookup(r.giftCard);
      if (!r.giftCard.usable) setGiftLookupError(r.giftCard.reason);
    } catch (e) {
      setGiftLookupError(e instanceof Error ? e.message : "Lookup failed");
    }
  }

  /* ── validation ── */
  const memberCredit = customer.kind === "member" ? customer.member.creditCents : 0;
  const tenderedCents = parseDollarsToCents(tendered);
  const changeCents = tenderedCents != null ? tenderedCents - totals.totalCents : null;
  let blocker: string | null = null;
  if (cart.length === 0) blocker = "Add an item";
  else if (payment === "CREDIT" && customer.kind !== "member") blocker = "Select a member to pay with credit";
  else if (payment === "CREDIT" && memberCredit < totals.totalCents) blocker = `Insufficient credit (${formatMoney(memberCredit, currency)})`;
  else if (payment === "GIFT_CARD" && (!giftLookup || !giftLookup.usable)) blocker = "Look up a valid gift card";
  else if (payment === "GIFT_CARD" && giftLookup && giftLookup.balanceCents < totals.totalCents) blocker = `Gift card balance ${formatMoney(giftLookup.balanceCents, currency)} doesn't cover the total`;
  else if (payment === "CARD" && !ctx?.squareReady) blocker = "Card payments need Square";
  else if (payment === "CARD" && !sourceId) blocker = "Enter card details";
  else if (payment === "CASH" && tendered.trim() && (tenderedCents == null || tenderedCents < totals.totalCents)) blocker = "Tendered is less than total";

  async function complete() {
    if (blocker) return;
    const pay: PaymentInput =
      payment === "CASH" ? { kind: "CASH", tenderedCents: tendered.trim() ? tenderedCents : null }
      : payment === "OTHER" ? { kind: "OTHER", reference: reference.trim() || null }
      : payment === "CREDIT" ? { kind: "CREDIT" }
      : payment === "GIFT_CARD" ? { kind: "GIFT_CARD", code: giftCode }
      : { kind: "CARD", sourceId: sourceId ?? "" };
    const body: CreateSaleRequest & { locationSlug: string } = {
      locationSlug: slug,
      items: cart.map(({ productId, description, quantity, unitCents, taxable, giftCard }) => ({ productId, description, quantity, unitCents, taxable, giftCard: giftCard ?? null })),
      discount: discountInput,
      customer: customer.kind === "member" ? { memberId: customer.member.id } : customer.kind === "walkin" ? { name: customer.name, email: customer.email } : {},
      notes: notes.trim() || null,
      payment: pay,
      sendReceipt,
    };
    setSubmitting(true);
    try {
      const r = await posFetch<{ sale: SaleDTO }>("/api/admin/sales", { method: "POST", body: JSON.stringify(body) });
      setReceipt(r.sale);
      setCartOpen(false);
      toast({ tone: "success", title: `Sale #${r.sale.number} complete`, description: formatMoney(r.sale.totalCents, currency) });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't complete sale", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  /* ── product grid data ── */
  const products = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return (ctx?.products ?? []).filter((p) => {
      if (category === "none" ? p.categoryId !== null : category !== "all" && p.categoryId !== category) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q);
    });
  }, [ctx, search, category]);
  const hasUncategorized = (ctx?.products ?? []).some((p) => !p.categoryId);

  if (receipt) {
    return <ReceiptView sale={receipt} currency={currency} slug={slug} onNew={resetSale} />;
  }

  const cartPanel = (
    <CartPanel
      cart={cart} totals={totals} currency={currency} taxRateBps={taxRateBps}
      discount={discount} setDiscount={setDiscount}
      customer={customer} setCustomer={setCustomer} slug={slug}
      notes={notes} setNotes={setNotes}
      payment={payment} setPayment={setPayment}
      tendered={tendered} setTendered={setTendered} changeCents={changeCents}
      reference={reference} setReference={setReference}
      giftCode={giftCode} setGiftCode={(v) => { setGiftCode(v); setGiftLookup(null); setGiftLookupError(null); }} giftLookup={giftLookup} giftLookupError={giftLookupError} onLookupGift={lookupGift}
      squareReady={!!ctx?.squareReady} sourceId={sourceId} setSourceId={setSourceId}
      sendReceipt={sendReceipt} setSendReceipt={setSendReceipt}
      onQty={changeQty} onRemove={removeLine}
      blocker={blocker} submitting={submitting} onComplete={complete}
    />
  );

  return (
    <div className="space-y-5 pb-24 lg:pb-0">
      <PageHeader
        title="New Sale"
        description={ctx ? `${ctx.location.name}${taxRateBps ? ` · tax ${(taxRateBps / 100).toFixed(2)}%` : " · no sales tax configured"}` : "Point of sale"}
        actions={
          <>
            <Button variant="secondary" iconLeft={<Tag className="h-4 w-4" />} onClick={() => setCustomOpen(true)}>Custom item</Button>
            <Button variant="secondary" iconLeft={<Gift className="h-4 w-4" />} onClick={() => setGiftOpen(true)}>Sell gift card</Button>
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-apple border border-apple-red/30 bg-apple-red/5 p-4 text-apple-sm text-apple-red">
          <span className="flex-1">{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* Products */}
        <div className="min-w-0 space-y-4">
          <Input prefix={<Search className="h-4 w-4" />} placeholder="Search products or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} className="text-apple-base" />
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            <Chip active={category === "all"} onClick={() => setCategory("all")}>All</Chip>
            {ctx?.categories.map((c) => (
              <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>{c.name}</Chip>
            ))}
            {hasUncategorized && <Chip active={category === "none"} onClick={() => setCategory("none")}>Other</Chip>}
          </div>

          {!ctx && !error && (
            <div className="grid animate-pulse grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-32 rounded-apple bg-white" />)}
            </div>
          )}
          {ctx && ctx.products.length === 0 && (
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title="No products yet"
              description="Add products to sell them with one tap, or ring up a custom item."
              action={<Link href={adminRoutes.loc.sales.productNew(slug)}><Button iconLeft={<Plus className="h-4 w-4" />}>Add product</Button></Link>}
            />
          )}
          {ctx && ctx.products.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {products.map((p) => {
                const inCart = cart.find((l) => l.productId === p.id)?.quantity ?? 0;
                const out = p.trackInventory && p.inventory <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={out}
                    onClick={() => addProduct(p)}
                    className={[
                      "relative flex min-h-[8rem] flex-col overflow-hidden rounded-apple border bg-white text-left shadow-apple transition-all active:scale-[0.98]",
                      inCart ? "border-apple-blue ring-2 ring-apple-blue/30" : "border-apple-border hover:border-apple-blue/50",
                      out ? "opacity-50" : "",
                    ].join(" ")}
                  >
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" className="h-20 w-full object-cover" />
                    ) : (
                      <div className="flex h-20 w-full items-center justify-center bg-apple-fill-secondary text-apple-text-tertiary"><Package className="h-6 w-6" /></div>
                    )}
                    <div className="flex flex-1 flex-col justify-between p-3">
                      <div className="line-clamp-2 text-apple-sm font-medium leading-tight text-apple-text">{p.name}</div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-apple-base font-semibold tabular-nums text-apple-text">{formatMoney(p.priceCents, currency)}</span>
                        {p.trackInventory && (
                          <span className={["text-[11px] tabular-nums", p.lowStock ? "font-medium text-apple-orange" : "text-apple-text-tertiary"].join(" ")}>{out ? "Out" : `${p.inventory} left`}</span>
                        )}
                      </div>
                    </div>
                    {inCart > 0 && (
                      <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-apple-blue px-2 text-apple-xs font-semibold text-white shadow">{inCart}</span>
                    )}
                  </button>
                );
              })}
              {products.length === 0 && <div className="col-span-full py-10 text-center text-apple-sm text-apple-text-tertiary">No products match.</div>}
            </div>
          )}
        </div>

        {/* Cart — side column on desktop */}
        <div className="hidden lg:block">
          <div className="sticky top-4">{cartPanel}</div>
        </div>
      </div>

      {/* Cart — bottom bar + sheet on mobile/tablet portrait */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-apple-divider bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <Button size="lg" className="w-full justify-between" onClick={() => setCartOpen(true)} iconLeft={<ShoppingCart className="h-5 w-5" />}>
          <span>{itemCount ? `${itemCount} item${itemCount === 1 ? "" : "s"}` : "Cart"}</span>
          <span className="tabular-nums">{formatMoney(totals.totalCents, currency)}</span>
        </Button>
      </div>
      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="Cart" wide>
        {cartPanel}
      </Modal>

      <CustomItemModal open={customOpen} onClose={() => setCustomOpen(false)} onAdd={addCustom} />
      <GiftCardSaleModal open={giftOpen} onClose={() => setGiftOpen(false)} onAdd={addGiftCard} />
    </div>
  );
}

/* ───────────────────────────── Cart panel ─────────────────────────────── */

type CartPanelProps = {
  cart: CartLine[];
  totals: ReturnType<typeof computeSaleTotals>;
  currency: string;
  taxRateBps: number;
  discount: { kind: "amount" | "percent"; value: string };
  setDiscount: (d: { kind: "amount" | "percent"; value: string }) => void;
  customer: CustomerState;
  setCustomer: (c: CustomerState) => void;
  slug: string;
  notes: string;
  setNotes: (v: string) => void;
  payment: PaymentKind;
  setPayment: (p: PaymentKind) => void;
  tendered: string;
  setTendered: (v: string) => void;
  changeCents: number | null;
  reference: string;
  setReference: (v: string) => void;
  giftCode: string;
  setGiftCode: (v: string) => void;
  giftLookup: GiftCardLookupDTO | null;
  giftLookupError: string | null;
  onLookupGift: () => void;
  squareReady: boolean;
  sourceId: string | null;
  setSourceId: (v: string | null) => void;
  sendReceipt: boolean;
  setSendReceipt: (v: boolean) => void;
  onQty: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  blocker: string | null;
  submitting: boolean;
  onComplete: () => void;
};

function CartPanel(p: CartPanelProps) {
  const customerEmail = p.customer.kind === "member" ? p.customer.member.email : p.customer.kind === "walkin" ? p.customer.email : "";
  return (
    <Card padded={false} className="flex max-h-[calc(100dvh-7rem)] flex-col lg:border lg:border-apple-border">
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {/* Lines */}
        <section>
          <SectionTitle icon={<ShoppingCart className="h-4 w-4" />}>Items</SectionTitle>
          {p.cart.length === 0 ? (
            <p className="rounded-apple-sm border border-dashed border-apple-border p-4 text-center text-apple-sm text-apple-text-tertiary">Tap a product to add it.</p>
          ) : (
            <ul className="divide-y divide-apple-divider">
              {p.cart.map((l) => (
                <li key={l.key} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-apple-sm font-medium text-apple-text">{l.description}</div>
                    <div className="text-apple-xs text-apple-text-tertiary">
                      {formatMoney(l.unitCents, p.currency)} each{!l.taxable ? " · no tax" : ""}
                    </div>
                  </div>
                  <div className="flex items-center rounded-apple-pill border border-apple-border">
                    <button type="button" aria-label="Decrease" className="flex h-9 w-9 items-center justify-center text-apple-text-secondary hover:text-apple-text" onClick={() => p.onQty(l.key, -1)}><Minus className="h-4 w-4" /></button>
                    <span className="w-6 text-center text-apple-sm tabular-nums">{l.quantity}</span>
                    <button type="button" aria-label="Increase" disabled={!!l.giftCard} className="flex h-9 w-9 items-center justify-center text-apple-text-secondary hover:text-apple-text disabled:opacity-30" onClick={() => p.onQty(l.key, 1)}><Plus className="h-4 w-4" /></button>
                  </div>
                  <div className="w-16 text-right text-apple-sm font-medium tabular-nums">{formatMoney(lineTotal(l), p.currency)}</div>
                  <button type="button" aria-label="Remove" className="p-1 text-apple-text-tertiary hover:text-apple-red" onClick={() => p.onRemove(l.key)}><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Discount */}
        <section>
          <SectionTitle icon={<Tag className="h-4 w-4" />}>Discount</SectionTitle>
          <div className="flex gap-2">
            <div className="flex overflow-hidden rounded-apple-sm border border-apple-border">
              {(["amount", "percent"] as const).map((k) => (
                <button key={k} type="button" onClick={() => p.setDiscount({ ...p.discount, kind: k })} className={["px-3 text-apple-sm font-medium", p.discount.kind === k ? "bg-apple-blue text-white" : "bg-white text-apple-text-secondary"].join(" ")}>
                  {k === "amount" ? "$" : "%"}
                </button>
              ))}
            </div>
            <Input inputMode="decimal" placeholder={p.discount.kind === "amount" ? "0.00" : "0"} value={p.discount.value} onChange={(e) => p.setDiscount({ ...p.discount, value: e.target.value })} />
          </div>
        </section>

        {/* Customer */}
        <section>
          <SectionTitle icon={<User className="h-4 w-4" />}>Customer</SectionTitle>
          <CustomerPicker slug={p.slug} value={p.customer} onChange={p.setCustomer} currency={p.currency} />
        </section>

        {/* Payment */}
        <section>
          <SectionTitle icon={<Wallet className="h-4 w-4" />}>Payment</SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
            {PAYMENT_ORDER.map((k) => {
              const disabled = (k === "CREDIT" && p.customer.kind !== "member");
              return (
                <button
                  key={k}
                  type="button"
                  disabled={disabled}
                  onClick={() => p.setPayment(k)}
                  className={[
                    "flex min-h-[3rem] items-center gap-2 rounded-apple-sm border px-3 text-left text-apple-sm font-medium transition-colors",
                    p.payment === k ? "border-apple-blue bg-apple-blue/10 text-apple-blue" : "border-apple-border bg-white text-apple-text hover:bg-apple-fill-secondary",
                    disabled ? "cursor-not-allowed opacity-40" : "",
                  ].join(" ")}
                >
                  {PAYMENT_ICONS[k]}
                  <span className="leading-tight">{k === "OTHER" ? "Other / terminal" : PAYMENT_KIND_LABELS[k]}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 space-y-3">
            {p.payment === "CASH" && (
              <div className="grid grid-cols-2 gap-3">
                <Input label="Tendered" inputMode="decimal" prefix="$" placeholder={centsToDollarsInput(p.totals.totalCents)} value={p.tendered} onChange={(e) => p.setTendered(e.target.value)} />
                <div>
                  <div className="mb-1.5 text-apple-xs font-medium text-apple-text-secondary">Change</div>
                  <div className={["flex h-[42px] items-center rounded-apple-sm border border-apple-border bg-apple-fill-secondary px-3 text-apple-base font-semibold tabular-nums", p.changeCents != null && p.changeCents < 0 ? "text-apple-red" : "text-apple-text"].join(" ")}>
                    {p.changeCents == null ? "—" : formatMoney(p.changeCents, p.currency)}
                  </div>
                </div>
                {!p.tendered && (
                  <div className="col-span-2 flex flex-wrap gap-2">
                    {quickTender(p.totals.totalCents).map((c) => (
                      <Button key={c} size="sm" variant="secondary" onClick={() => p.setTendered(centsToDollarsInput(c))}>{formatMoney(c, p.currency)}</Button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {p.payment === "OTHER" && (
              <Input label="Reference (optional)" placeholder="Terminal receipt #, Venmo, etc." value={p.reference} onChange={(e) => p.setReference(e.target.value)} />
            )}
            {p.payment === "CREDIT" && p.customer.kind === "member" && (
              <div className={["rounded-apple-sm border p-3 text-apple-sm", p.customer.member.creditCents >= p.totals.totalCents ? "border-apple-green/30 bg-apple-green/5" : "border-apple-red/30 bg-apple-red/5"].join(" ")}>
                Credit balance <strong className="tabular-nums">{formatMoney(p.customer.member.creditCents, p.currency)}</strong>
                {p.customer.member.creditCents >= p.totals.totalCents
                  ? <span className="text-apple-text-secondary"> → {formatMoney(p.customer.member.creditCents - p.totals.totalCents, p.currency)} after this sale</span>
                  : <span className="text-apple-red"> — not enough to cover {formatMoney(p.totals.totalCents, p.currency)}</span>}
              </div>
            )}
            {p.payment === "GIFT_CARD" && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input placeholder="XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" value={p.giftCode} onChange={(e) => p.setGiftCode(formatGiftInput(e.target.value))} className="font-mono uppercase tracking-wider" />
                  <Button variant="secondary" onClick={p.onLookupGift} disabled={p.giftCode.replace(/-/g, "").length < 16}>Check</Button>
                </div>
                {p.giftLookupError && <p className="text-apple-xs text-apple-red">{p.giftLookupError}</p>}
                {p.giftLookup && p.giftLookup.usable && (
                  <div className={["rounded-apple-sm border p-3 text-apple-sm", p.giftLookup.balanceCents >= p.totals.totalCents ? "border-apple-green/30 bg-apple-green/5" : "border-apple-red/30 bg-apple-red/5"].join(" ")}>
                    Card {p.giftLookup.codeMasked} · balance <strong className="tabular-nums">{formatMoney(p.giftLookup.balanceCents, p.currency)}</strong>
                    {p.giftLookup.balanceCents < p.totals.totalCents && <span className="text-apple-red"> — full coverage required</span>}
                  </div>
                )}
              </div>
            )}
            {p.payment === "CARD" && (
              <CardSlot ready={p.squareReady} amountCents={p.totals.totalCents} currency={p.currency} sourceId={p.sourceId} onSourceId={p.setSourceId} />
            )}
          </div>
        </section>

        <section>
          <Textarea label="Notes (optional)" rows={2} value={p.notes} onChange={(e) => p.setNotes(e.target.value)} placeholder="Printed on the receipt" />
          {customerEmail && (
            <label className="mt-3 flex items-center gap-2 text-apple-sm text-apple-text">
              <input type="checkbox" className="h-4 w-4 accent-apple-blue" checked={p.sendReceipt} onChange={(e) => p.setSendReceipt(e.target.checked)} />
              Email receipt to {customerEmail}
            </label>
          )}
        </section>
      </div>

      {/* Totals + complete */}
      <div className="border-t border-apple-divider bg-apple-fill-secondary p-4">
        <dl className="space-y-1 text-apple-sm">
          <Row label="Subtotal" value={formatMoney(p.totals.subtotalCents, p.currency)} />
          {p.totals.discountCents > 0 && <Row label="Discount" value={`−${formatMoney(p.totals.discountCents, p.currency)}`} />}
          <Row label={`Tax${p.taxRateBps ? ` (${(p.taxRateBps / 100).toFixed(2)}%)` : ""}`} value={formatMoney(p.totals.taxCents, p.currency)} />
          <div className="flex items-baseline justify-between pt-2 text-apple-lg font-semibold text-apple-text">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(p.totals.totalCents, p.currency)}</dd>
          </div>
        </dl>
        <Button size="lg" className="mt-3 w-full" disabled={!!p.blocker} loading={p.submitting} onClick={p.onComplete} iconLeft={<CheckCircle2 className="h-5 w-5" />}>
          {p.blocker ?? `Complete · ${formatMoney(p.totals.totalCents, p.currency)}`}
        </Button>
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-apple-text-secondary">
      <dt>{label}</dt>
      <dd className="tabular-nums text-apple-text">{value}</dd>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <h3 className="mb-2 flex items-center gap-1.5 text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">{icon}{children}</h3>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={["shrink-0 rounded-apple-pill border px-4 py-2 text-apple-sm font-medium transition-colors", active ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border bg-white text-apple-text hover:bg-apple-fill-secondary"].join(" ")}>
      {children}
    </button>
  );
}

function quickTender(totalCents: number): number[] {
  const out = new Set<number>();
  out.add(totalCents);
  for (const step of [100, 500, 1000, 2000, 5000, 10000]) {
    const v = Math.ceil(totalCents / step) * step;
    if (v > totalCents) out.add(v);
    if (out.size >= 4) break;
  }
  return [...out].sort((a, b) => a - b).slice(0, 4);
}

function formatGiftInput(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  return (s.match(/.{1,4}/g) ?? []).join("-");
}

/* ───────────────────────────── Customer picker ────────────────────────── */

function CustomerPicker({ slug, value, onChange, currency }: { slug: string; value: CustomerState; onChange: (c: CustomerState) => void; currency: string }) {
  const [mode, setMode] = React.useState<"member" | "walkin">(value.kind === "walkin" ? "walkin" : "member");
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<CustomerDTO[]>([]);
  const [searching, setSearching] = React.useState(false);

  React.useEffect(() => {
    if (mode !== "member" || q.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await posFetch<{ customers: CustomerDTO[] }>(`/api/admin/sales/customers${qs({ locationSlug: slug, q })}`);
        if (!cancelled) setResults(r.customers);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, mode, slug]);

  if (value.kind === "member") {
    return (
      <div className="flex items-center gap-3 rounded-apple-sm border border-apple-blue/30 bg-apple-blue/5 p-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-apple-blue/10 text-apple-sm font-semibold text-apple-blue">{value.member.firstName[0]}{value.member.lastName[0]}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-apple-sm font-medium text-apple-text">{value.member.firstName} {value.member.lastName} <Badge size="sm" tone={value.member.status === "ACTIVE" ? "success" : "muted"}>{value.member.status}</Badge></div>
          <div className="truncate text-apple-xs text-apple-text-secondary">{value.member.email} · credit {formatMoney(value.member.creditCents, currency)}</div>
        </div>
        <button type="button" aria-label="Clear customer" className="p-1 text-apple-text-tertiary hover:text-apple-text" onClick={() => { onChange({ kind: "none" }); setQ(""); }}><X className="h-4 w-4" /></button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex overflow-hidden rounded-apple-sm border border-apple-border text-apple-sm">
        <button type="button" onClick={() => { setMode("member"); if (value.kind === "walkin") onChange({ kind: "none" }); }} className={["flex-1 py-2 font-medium", mode === "member" ? "bg-apple-blue text-white" : "bg-white text-apple-text-secondary"].join(" ")}>Member</button>
        <button type="button" onClick={() => { setMode("walkin"); onChange({ kind: "walkin", name: "", email: "" }); }} className={["flex-1 py-2 font-medium", mode === "walkin" ? "bg-apple-blue text-white" : "bg-white text-apple-text-secondary"].join(" ")}>Walk-in</button>
      </div>
      {mode === "member" ? (
        <div className="relative">
          <Input prefix={<Search className="h-4 w-4" />} placeholder="Search name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          {(results.length > 0 || (searching && q.trim().length >= 2)) && (
            <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-apple-sm border border-apple-border bg-white shadow-apple-lg">
              {searching && results.length === 0 && <li className="px-3 py-2 text-apple-xs text-apple-text-tertiary">Searching…</li>}
              {results.map((m) => (
                <li key={m.id}>
                  <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-apple-sm hover:bg-apple-fill-secondary" onClick={() => { onChange({ kind: "member", member: m }); setQ(""); setResults([]); }}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-apple-text">{m.firstName} {m.lastName}</span>
                      <span className="block truncate text-apple-xs text-apple-text-tertiary">{m.email}</span>
                    </span>
                    {m.creditCents > 0 && <Badge size="sm" tone="info">{formatMoney(m.creditCents, currency)} credit</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && !searching && results.length === 0 && <p className="mt-1 text-apple-xs text-apple-text-tertiary">No members found — use Walk-in.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
          <Input placeholder="Name (optional)" value={value.kind === "walkin" ? value.name : ""} onChange={(e) => onChange({ kind: "walkin", name: e.target.value, email: value.kind === "walkin" ? value.email : "" })} />
          <Input type="email" inputMode="email" placeholder="Email for receipt (optional)" value={value.kind === "walkin" ? value.email : ""} onChange={(e) => onChange({ kind: "walkin", name: value.kind === "walkin" ? value.name : "", email: e.target.value })} />
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Modals ─────────────────────────────────── */

function CustomItemModal({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (l: { description: string; unitCents: number; quantity: number; taxable: boolean }) => void }) {
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [qty, setQty] = React.useState("1");
  const [taxable, setTaxable] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  function submit() {
    const cents = parseDollarsToCents(amount);
    const q = Number(qty);
    if (!description.trim()) return setErr("Description is required");
    if (cents == null) return setErr("Enter a valid amount");
    if (!Number.isInteger(q) || q < 1) return setErr("Quantity must be at least 1");
    onAdd({ description: description.trim(), unitCents: cents, quantity: q, taxable });
    setDescription(""); setAmount(""); setQty("1"); setTaxable(true); setErr(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Custom line item" description="Ring up something that isn't in the catalog."
      footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit}>Add to cart</Button></div>}>
      <div className="space-y-4">
        <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Range balls, lesson, etc." autoFocus />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Amount" prefix="$" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          <Input label="Quantity" type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-apple-sm text-apple-text">
          <input type="checkbox" className="h-4 w-4 accent-apple-blue" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} /> Taxable
        </label>
        {err && <p className="text-apple-sm text-apple-red">{err}</p>}
      </div>
    </Modal>
  );
}

function GiftCardSaleModal({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (g: { amountCents: number; recipientName: string; recipientEmail: string }) => void }) {
  const [amount, setAmount] = React.useState("");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);

  function submit() {
    const cents = parseDollarsToCents(amount);
    if (cents == null || cents < 100) return setErr("Amount must be at least $1");
    if (email.trim() && !email.includes("@")) return setErr("Enter a valid email");
    onAdd({ amountCents: cents, recipientName: name.trim(), recipientEmail: email.trim() });
    setAmount(""); setName(""); setEmail(""); setErr(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Sell a gift card" description="A code is generated when the sale completes and emailed to the recipient if an address is given."
      footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} iconLeft={<Gift className="h-4 w-4" />}>Add to cart</Button></div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {[2500, 5000, 10000, 15000, 20000].map((c) => (
            <Button key={c} size="sm" variant={parseDollarsToCents(amount) === c ? "primary" : "secondary"} onClick={() => setAmount(centsToDollarsInput(c))}>{formatMoney(c)}</Button>
          ))}
        </div>
        <Input label="Amount" prefix="$" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50.00" />
        <Input label="Recipient name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Recipient email (optional)" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="The full code is emailed here." />
        {err && <p className="text-apple-sm text-apple-red">{err}</p>}
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Receipt view ───────────────────────────── */

function ReceiptView({ sale, currency, slug, onNew }: { sale: SaleDTO; currency: string; slug: string; onNew: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = React.useState(sale.customerEmail ?? "");
  const [sending, setSending] = React.useState(false);

  async function send() {
    setSending(true);
    try {
      const r = await posFetch<{ sent: boolean; to: string }>(`/api/admin/sales/${encodeURIComponent(sale.id)}/receipt`, { method: "POST", body: JSON.stringify({ locationSlug: slug, to: email }) });
      toast(r.sent ? { tone: "success", title: `Receipt sent to ${r.to}` } : { tone: "error", title: "Email not configured" });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't send receipt", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Card className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-apple-green/10 text-apple-green"><CheckCircle2 className="h-8 w-8" /></div>
        <h1 className="mt-3 text-apple-2xl font-semibold text-apple-text">Sale #{sale.number} complete</h1>
        <div className="mt-1 text-apple-3xl font-semibold tabular-nums text-apple-text">{formatMoney(sale.totalCents, currency)}</div>
        <div className="mt-1 text-apple-sm text-apple-text-secondary">
          {PAYMENT_KIND_LABELS[sale.paymentKind]}
          {sale.payment.changeCents != null && sale.payment.changeCents > 0 && <> · change <strong className="tabular-nums text-apple-text">{formatMoney(sale.payment.changeCents, currency)}</strong></>}
          {sale.customerName && <> · {sale.customerName}</>}
        </div>

        <ul className="mt-5 divide-y divide-apple-divider text-left text-apple-sm">
          {sale.lineItems.map((li) => (
            <li key={li.id} className="flex justify-between py-2">
              <span className="text-apple-text">{li.quantity > 1 ? `${li.quantity} × ` : ""}{li.description}</span>
              <span className="tabular-nums">{formatMoney(li.totalCents, currency)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-apple-divider pt-3 text-apple-sm">
          <Row label="Subtotal" value={formatMoney(sale.subtotalCents, currency)} />
          {sale.discountCents > 0 && <Row label="Discount" value={`−${formatMoney(sale.discountCents, currency)}`} />}
          <Row label="Tax" value={formatMoney(sale.taxCents, currency)} />
        </dl>
        {sale.lineItems.some((li) => li.description.startsWith("Gift card")) && (
          <p className="mt-4 rounded-apple-sm bg-apple-blue/5 p-3 text-apple-xs text-apple-text-secondary">Gift card codes were emailed to the recipient where an address was given. Full codes are also visible on the Gift Cards page right after issue.</p>
        )}
      </Card>

      <Card>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="email" placeholder="Email receipt to…" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button variant="secondary" onClick={() => void send()} loading={sending} disabled={!email.includes("@")}>Send receipt</Button>
        </div>
        {sale.customerEmail && <p className="mt-2 text-apple-xs text-apple-text-tertiary">A receipt was emailed to {sale.customerEmail} automatically.</p>}
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="lg" className="flex-1" onClick={onNew} iconLeft={<Plus className="h-5 w-5" />}>New sale</Button>
        <Link href={adminRoutes.loc.sales.list(slug)} className="flex-1"><Button size="lg" variant="secondary" className="w-full">View sales</Button></Link>
      </div>
    </div>
  );
}
