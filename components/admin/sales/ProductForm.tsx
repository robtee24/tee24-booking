// components/admin/sales/ProductForm.tsx
"use client";

import Link from "next/link";
import React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Package, Save } from "lucide-react";
import { Badge, Button, Card, Input, Modal, PageHeader, Select, Textarea, useToast } from "@/components/ui";
import { Toggle } from "@/components/admin/location-settings/SettingsSection";
import { adminRoutes } from "@/lib/admin/routes";
import { posFetch, qs } from "./api";
import { centsToDollarsInput, parseDollarsToCents } from "./pos-math";
import type { CategoryDTO, ProductDTO, ProductInput } from "./types";

type Form = {
  name: string; description: string; categoryId: string; sku: string; price: string; cogs: string; taxable: boolean;
  trackInventory: boolean; inventory: string; lowStockAt: string; imageUrl: string; glCode: string; incomeCategory: string; active: boolean; scope: "all" | "location";
};

const EMPTY: Form = {
  name: "", description: "", categoryId: "", sku: "", price: "", cogs: "", taxable: true,
  trackInventory: false, inventory: "0", lowStockAt: "", imageUrl: "", glCode: "", incomeCategory: "", active: true, scope: "all",
};

function fromProduct(p: ProductDTO): Form {
  return {
    name: p.name, description: p.description ?? "", categoryId: p.categoryId ?? "", sku: p.sku ?? "", price: centsToDollarsInput(p.priceCents),
    cogs: p.cogsCents != null ? centsToDollarsInput(p.cogsCents) : "", taxable: p.taxable, trackInventory: p.trackInventory, inventory: String(p.inventory),
    lowStockAt: p.lowStockAt != null ? String(p.lowStockAt) : "", imageUrl: p.imageUrl ?? "", glCode: p.glCode ?? "", incomeCategory: p.incomeCategory ?? "",
    active: p.active, scope: p.locationId ? "location" : "all",
  };
}

const NEW_CATEGORY = "__new__";

export function ProductForm({ slug, productId }: { slug: string; productId?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = React.useState<Form>(EMPTY);
  const [product, setProduct] = React.useState<ProductDTO | null>(null);
  const [categories, setCategories] = React.useState<CategoryDTO[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [newCategory, setNewCategory] = React.useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cats, prod] = await Promise.all([
          posFetch<{ categories: CategoryDTO[] }>(`/api/admin/products/categories${qs({ locationSlug: slug })}`),
          productId ? posFetch<{ product: ProductDTO }>(`/api/admin/products/${encodeURIComponent(productId)}${qs({ locationSlug: slug })}`) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setCategories(cats.categories);
        if (prod) { setProduct(prod.product); setForm(fromProduct(prod.product)); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, productId]);

  function set<K extends keyof Form>(k: K, v: Form[K]) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    setError(null);
    const priceCents = parseDollarsToCents(form.price);
    if (!form.name.trim()) return setError("Name is required");
    if (priceCents == null) return setError("Enter a valid price");
    const cogsCents = form.cogs.trim() ? parseDollarsToCents(form.cogs) : null;
    if (form.cogs.trim() && cogsCents == null) return setError("Enter a valid COGS");
    const inventory = Number(form.inventory || 0);
    if (form.trackInventory && !Number.isInteger(inventory)) return setError("Inventory must be a whole number");

    let categoryId: string | null = form.categoryId || null;
    setSaving(true);
    try {
      if (newCategory !== null) {
        if (!newCategory.trim()) throw new Error("Enter a name for the new category");
        const r = await posFetch<{ category: { id: string } }>("/api/admin/products/categories", { method: "POST", body: JSON.stringify({ locationSlug: slug, name: newCategory.trim() }) });
        categoryId = r.category.id;
      }
      const body: ProductInput & { locationSlug: string } = {
        locationSlug: slug,
        name: form.name.trim(), description: form.description, categoryId, sku: form.sku, priceCents, cogsCents, taxable: form.taxable,
        trackInventory: form.trackInventory, inventory: form.trackInventory ? inventory : 0,
        lowStockAt: form.trackInventory && form.lowStockAt.trim() ? Number(form.lowStockAt) : null,
        imageUrl: form.imageUrl, glCode: form.glCode, incomeCategory: form.incomeCategory, active: form.active, scope: form.scope,
      };
      const r = productId
        ? await posFetch<{ product: ProductDTO }>(`/api/admin/products/${encodeURIComponent(productId)}`, { method: "PATCH", body: JSON.stringify(body) })
        : await posFetch<{ product: ProductDTO }>("/api/admin/products", { method: "POST", body: JSON.stringify(body) });
      toast({ tone: "success", title: productId ? "Product saved" : "Product created" });
      if (productId) { setProduct(r.product); setForm(fromProduct(r.product)); setNewCategory(null); router.refresh(); }
      else router.push(adminRoutes.loc.sales.products(slug));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive() {
    if (!product) return;
    setSaving(true);
    try {
      const r = await posFetch<{ product: ProductDTO }>(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: "PATCH", body: JSON.stringify({ locationSlug: slug, active: !product.active }) });
      setProduct(r.product); setForm(fromProduct(r.product)); setArchiveOpen(false);
      toast({ tone: "success", title: r.product.active ? "Product restored" : "Product archived" });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't update", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={productId ? (product?.name ?? "Edit product") : "New product"}
        description={productId ? "Changes apply to the New Sale screen immediately." : "Products appear as tiles on the New Sale screen."}
        meta={product && (
          <>
            {!product.active && <Badge tone="muted">Archived</Badge>}
            {product.lowStock && <Badge tone="warn">Low stock</Badge>}
            <Badge tone="muted">{product.locationId ? "This location" : "All locations"}</Badge>
          </>
        )}
        actions={
          <>
            <Link href={adminRoutes.loc.sales.products(slug)}><Button variant="secondary">Back</Button></Link>
            {product && (
              <Button variant={product.active ? "danger" : "secondary"} iconLeft={product.active ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />} onClick={() => (product.active ? setArchiveOpen(true) : void toggleArchive())}>
                {product.active ? "Archive" : "Restore"}
              </Button>
            )}
            <Button iconLeft={<Save className="h-4 w-4" />} loading={saving} onClick={() => void save()} disabled={loading}>Save</Button>
          </>
        }
      />

      {loading ? (
        <div className="h-96 animate-pulse rounded-apple bg-white" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <Card>
              <h2 className="mb-4 text-apple-lg font-semibold text-apple-text">Basics</h2>
              <div className="space-y-4">
                <Input label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} required autoFocus={!productId} />
                <Textarea label="Description (optional)" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Select label="Category" value={newCategory !== null ? NEW_CATEGORY : form.categoryId} onChange={(e) => { if (e.target.value === NEW_CATEGORY) setNewCategory(""); else { setNewCategory(null); set("categoryId", e.target.value); } }}>
                      <option value="">Uncategorized</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      <option value={NEW_CATEGORY}>+ New category…</option>
                    </Select>
                    {newCategory !== null && <Input className="mt-2" placeholder="New category name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} autoFocus />}
                  </div>
                  <Input label="SKU (optional)" value={form.sku} onChange={(e) => set("sku", e.target.value)} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Price" prefix="$" inputMode="decimal" value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="0.00" required />
                  <Input label="Cost of goods (optional)" prefix="$" inputMode="decimal" value={form.cogs} onChange={(e) => set("cogs", e.target.value)} placeholder="0.00" hint="Used for gross profit in the report." />
                </div>
                <Toggle checked={form.taxable} onChange={(v) => set("taxable", v)} label="Taxable" hint="Sales tax from Location Settings → Tax is applied to this item." />
              </div>
            </Card>

            <Card>
              <h2 className="mb-4 text-apple-lg font-semibold text-apple-text">Inventory</h2>
              <div className="space-y-4">
                <Toggle checked={form.trackInventory} onChange={(v) => set("trackInventory", v)} label="Track inventory" hint="Decrements on each sale; blocks sales when out of stock." />
                {form.trackInventory && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Quantity on hand" type="number" inputMode="numeric" value={form.inventory} onChange={(e) => set("inventory", e.target.value)} />
                    <Input label="Low-stock alert at (optional)" type="number" inputMode="numeric" min={0} value={form.lowStockAt} onChange={(e) => set("lowStockAt", e.target.value)} placeholder="e.g. 5" />
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <h2 className="mb-4 text-apple-lg font-semibold text-apple-text">Display</h2>
              <div className="space-y-4">
                <Input label="Image URL (optional)" value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://…" />
                {form.imageUrl.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.imageUrl} alt="" className="h-28 w-full rounded-apple-sm border border-apple-border object-cover" />
                ) : (
                  <div className="flex h-28 items-center justify-center rounded-apple-sm border border-dashed border-apple-border text-apple-text-tertiary"><Package className="h-6 w-6" /></div>
                )}
                <Toggle checked={form.active} onChange={(v) => set("active", v)} label="Active" hint="Inactive products are hidden from the New Sale screen." />
              </div>
            </Card>
            <Card>
              <h2 className="mb-4 text-apple-lg font-semibold text-apple-text">Accounting</h2>
              <div className="space-y-4">
                <Input label="GL code (optional)" value={form.glCode} onChange={(e) => set("glCode", e.target.value)} placeholder="4100" />
                <Input label="Income category (optional)" value={form.incomeCategory} onChange={(e) => set("incomeCategory", e.target.value)} placeholder="Pro shop" />
                <Select label="Available at" value={form.scope} onChange={(e) => set("scope", e.target.value as Form["scope"])}>
                  <option value="all">All locations</option>
                  <option value="location">This location only</option>
                </Select>
              </div>
            </Card>
            {error && <p className="text-apple-sm text-apple-red">{error}</p>}
          </div>
        </div>
      )}

      <Modal open={archiveOpen} onClose={() => setArchiveOpen(false)} title="Archive this product?" description="It disappears from the New Sale screen. Past sales keep their history and you can restore it later."
        footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={() => setArchiveOpen(false)}>Keep</Button><Button variant="danger" loading={saving} onClick={() => void toggleArchive()}>Archive</Button></div>}>
        <span />
      </Modal>
    </div>
  );
}
