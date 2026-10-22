// components/admin/sales/ProductsScreen.tsx
"use client";

import Link from "next/link";
import React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Download, FolderTree, GripVertical, Package, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { Badge, Button, DataTable, Drawer, EmptyState, Input, Modal, PageHeader, Select, formatMoney, useToast, type Column } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { downloadCsv, parseCsv, posFetch, qs } from "./api";
import type { CategoryDTO, ProductDTO } from "./types";

export function ProductsScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [products, setProducts] = React.useState<ProductDTO[] | null>(null);
  const [categories, setCategories] = React.useState<CategoryDTO[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [active, setActive] = React.useState<"active" | "archived" | "all">("active");
  const [lowOnly, setLowOnly] = React.useState(false);
  const [catsOpen, setCatsOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        posFetch<{ products: ProductDTO[] }>(`/api/admin/products${qs({ locationSlug: slug, q, categoryId, active, lowStock: lowOnly ? 1 : undefined })}`),
        posFetch<{ categories: CategoryDTO[] }>(`/api/admin/products/categories${qs({ locationSlug: slug })}`),
      ]);
      setProducts(p.products);
      setCategories(c.categories);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load products");
    }
  }, [slug, q, categoryId, active, lowOnly]);

  React.useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function toggleActive(p: ProductDTO) {
    try {
      await posFetch(`/api/admin/products/${encodeURIComponent(p.id)}`, { method: "PATCH", body: JSON.stringify({ locationSlug: slug, active: !p.active }) });
      toast({ tone: "success", title: p.active ? `${p.name} archived` : `${p.name} restored` });
      await load();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't update product", description: e instanceof Error ? e.message : undefined });
    }
  }

  const lowCount = products?.filter((p) => p.lowStock).length ?? 0;

  const columns: Column<ProductDTO>[] = [
    {
      key: "name", header: "Product",
      cell: (p) => (
        <div className="flex items-center gap-3">
          {p.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-apple-sm object-cover" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-apple-sm bg-apple-fill-secondary text-apple-text-tertiary"><Package className="h-4 w-4" /></div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 font-medium text-apple-text">
              <span className="truncate">{p.name}</span>
              {!p.active && <Badge size="sm" tone="muted">Archived</Badge>}
              {p.lowStock && <Badge size="sm" tone="warn">Low stock</Badge>}
              {!p.taxable && <Badge size="sm" tone="muted">No tax</Badge>}
            </div>
            <div className="text-apple-xs text-apple-text-tertiary">{[p.sku, p.locationId ? "This location" : null].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      ),
    },
    { key: "category", header: "Category", cell: (p) => <span className="text-apple-text-secondary">{p.categoryName ?? "—"}</span> },
    { key: "price", header: "Price", align: "right", cell: (p) => <span className="tabular-nums">{formatMoney(p.priceCents)}</span> },
    { key: "cogs", header: "COGS", align: "right", cell: (p) => <span className="tabular-nums text-apple-text-secondary">{p.cogsCents != null ? formatMoney(p.cogsCents) : "—"}</span> },
    {
      key: "inventory", header: "Stock", align: "right",
      cell: (p) => (p.trackInventory ? <span className={["tabular-nums", p.lowStock ? "font-medium text-apple-orange" : ""].join(" ")}>{p.inventory}{p.lowStockAt != null ? <span className="text-apple-text-tertiary"> / {p.lowStockAt}</span> : null}</span> : <span className="text-apple-text-tertiary">—</span>),
    },
    {
      key: "actions", header: "", align: "right", width: "110px",
      cell: (p) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Link href={adminRoutes.loc.sales.productDetail(slug, p.id)} className="rounded-apple-sm p-2 text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text" aria-label="Edit"><Pencil className="h-4 w-4" /></Link>
          <button type="button" className="rounded-apple-sm p-2 text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text" aria-label={p.active ? "Archive" : "Restore"} onClick={() => void toggleActive(p)}>
            {p.active ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Catalog for the point of sale. Prices and tax apply the moment you save."
        meta={products && (
          <>
            <Badge tone="muted">{products.length} shown</Badge>
            {lowCount > 0 && <Badge tone="warn">{lowCount} low stock</Badge>}
          </>
        )}
        actions={
          <>
            <Button variant="secondary" iconLeft={<FolderTree className="h-4 w-4" />} onClick={() => setCatsOpen(true)}>Categories</Button>
            <Button variant="secondary" iconLeft={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>Import CSV</Button>
            <Button variant="secondary" iconLeft={<Download className="h-4 w-4" />} onClick={() => downloadCsv(`/api/admin/products${qs({ locationSlug: slug, q, categoryId, active, format: "csv" })}`)}>Export</Button>
            <Link href={adminRoutes.loc.sales.productNew(slug)}><Button iconLeft={<Plus className="h-4 w-4" />}>New product</Button></Link>
          </>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1"><Input prefix={<Search className="h-4 w-4" />} placeholder="Search name, SKU, description…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="none">Uncategorized</option>
          </Select>
          <Select value={active} onChange={(e) => setActive(e.target.value as typeof active)}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </Select>
          <label className="col-span-2 flex items-center gap-2 text-apple-sm text-apple-text sm:col-span-1">
            <input type="checkbox" className="h-4 w-4 accent-apple-blue" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only
          </label>
        </div>
      </div>

      {error && <div className="rounded-apple border border-apple-red/30 bg-apple-red/5 p-4 text-apple-sm text-apple-red">{error}</div>}

      {products && products.length === 0 && !q && !categoryId && active === "active" && !lowOnly ? (
        <EmptyState icon={<Package className="h-6 w-6" />} title="No products yet" description="Add your first product or import a CSV with name, sku, price, category, inventory."
          action={<div className="flex gap-2"><Button variant="secondary" onClick={() => setImportOpen(true)}>Import CSV</Button><Link href={adminRoutes.loc.sales.productNew(slug)}><Button>New product</Button></Link></div>} />
      ) : (
        <DataTable columns={columns} rows={products ?? []} rowKey={(p) => p.id} loading={!products && !error} onRowClick={(p) => router.push(adminRoutes.loc.sales.productDetail(slug, p.id))} empty="No products match these filters." />
      )}

      <CategoriesDrawer open={catsOpen} onClose={() => setCatsOpen(false)} slug={slug} categories={categories} onChanged={load} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} slug={slug} onDone={load} />
    </div>
  );
}

/* ───────────────────────────── Categories drawer ──────────────────────── */

function CategoriesDrawer({ open, onClose, slug, categories, onChanged }: { open: boolean; onClose: () => void; slug: string; categories: CategoryDTO[]; onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);
  const [confirm, setConfirm] = React.useState<CategoryDTO | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast({ tone: "success", title: ok }); await onChanged(); }
    catch (e) { toast({ tone: "error", title: "Couldn't save", description: e instanceof Error ? e.message : undefined }); }
    finally { setBusy(false); }
  }

  const add = () => run(async () => {
    await posFetch("/api/admin/products/categories", { method: "POST", body: JSON.stringify({ locationSlug: slug, name }) });
    setName("");
  }, "Category added");
  const rename = () => editing && run(async () => {
    await posFetch(`/api/admin/products/categories/${encodeURIComponent(editing.id)}`, { method: "PATCH", body: JSON.stringify({ locationSlug: slug, name: editing.name }) });
    setEditing(null);
  }, "Category renamed");
  const move = (c: CategoryDTO, dir: -1 | 1) => {
    const i = categories.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (j < 0 || j >= categories.length) return;
    const other = categories[j];
    void run(async () => {
      await Promise.all([
        posFetch(`/api/admin/products/categories/${encodeURIComponent(c.id)}`, { method: "PATCH", body: JSON.stringify({ locationSlug: slug, sortOrder: j }) }),
        posFetch(`/api/admin/products/categories/${encodeURIComponent(other.id)}`, { method: "PATCH", body: JSON.stringify({ locationSlug: slug, sortOrder: i }) }),
      ]);
    }, "Order updated");
  };
  const remove = () => confirm && run(async () => {
    await posFetch(`/api/admin/products/categories/${encodeURIComponent(confirm.id)}${qs({ locationSlug: slug })}`, { method: "DELETE" });
    setConfirm(null);
  }, "Category deleted");

  return (
    <Drawer open={open} onClose={onClose} title="Categories" description="Group products into tabs on the New Sale screen. Order here is the tab order." width="md">
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && void add()} />
          <Button onClick={() => void add()} disabled={!name.trim()} loading={busy} iconLeft={<Plus className="h-4 w-4" />}>Add</Button>
        </div>
        {categories.length === 0 ? (
          <p className="text-apple-sm text-apple-text-tertiary">No categories yet.</p>
        ) : (
          <ul className="divide-y divide-apple-divider rounded-apple border border-apple-border bg-white">
            {categories.map((c, i) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                <div className="flex flex-col text-apple-text-tertiary">
                  <button type="button" disabled={i === 0 || busy} className="disabled:opacity-20" aria-label="Move up" onClick={() => move(c, -1)}>▲</button>
                  <button type="button" disabled={i === categories.length - 1 || busy} className="disabled:opacity-20" aria-label="Move down" onClick={() => move(c, 1)}>▼</button>
                </div>
                <GripVertical className="h-4 w-4 text-apple-text-tertiary" />
                {editing?.id === c.id ? (
                  <>
                    <Input value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void rename()} autoFocus />
                    <Button size="sm" onClick={() => void rename()} loading={busy}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-apple-sm font-medium text-apple-text">{c.name}</div>
                      <div className="text-apple-xs text-apple-text-tertiary">{c.productCount ?? 0} product{c.productCount === 1 ? "" : "s"}</div>
                    </div>
                    <button type="button" className="rounded-apple-sm p-2 text-apple-text-secondary hover:bg-apple-fill-secondary" aria-label="Rename" onClick={() => setEditing({ id: c.id, name: c.name })}><Pencil className="h-4 w-4" /></button>
                    <button type="button" className="rounded-apple-sm p-2 text-apple-text-tertiary hover:bg-apple-red/5 hover:text-apple-red" aria-label="Delete" onClick={() => setConfirm(c)}><Trash2 className="h-4 w-4" /></button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Modal open={confirm !== null} onClose={() => setConfirm(null)} title={confirm ? `Delete “${confirm.name}”?` : "Delete category"} description="Products in this category become uncategorized. Nothing else is removed."
        footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={() => setConfirm(null)}>Keep</Button><Button variant="danger" loading={busy} onClick={() => void remove()}>Delete</Button></div>}>
        <span />
      </Modal>
    </Drawer>
  );
}

/* ───────────────────────────── CSV import ─────────────────────────────── */

type ImportRow = { name: string; sku: string; price: string; category: string; inventory: string };

function ImportModal({ open, onClose, slug, onDone }: { open: boolean; onClose: () => void; slug: string; onDone: () => Promise<void> }) {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<ImportRow[]>([]);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ created: number; updated: number; skipped: number; errors: string[] } | null>(null);

  function onFile(f: File | null) {
    setError(null); setResult(null); setRows([]);
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ""));
      if (parsed.length < 2) return setError("CSV needs a header row and at least one product.");
      const header = parsed[0].map((h) => h.trim().toLowerCase());
      const col = (names: string[]) => header.findIndex((h) => names.includes(h));
      const iName = col(["name", "product", "product name"]);
      const iPrice = col(["price", "price_cents", "amount"]);
      if (iName < 0 || iPrice < 0) return setError("CSV must include “name” and “price” columns.");
      const iSku = col(["sku", "code"]); const iCat = col(["category"]); const iInv = col(["inventory", "stock", "qty", "quantity"]);
      setRows(parsed.slice(1).map((r) => ({ name: r[iName] ?? "", sku: iSku >= 0 ? r[iSku] ?? "" : "", price: r[iPrice] ?? "", category: iCat >= 0 ? r[iCat] ?? "" : "", inventory: iInv >= 0 ? r[iInv] ?? "" : "" })));
    };
    reader.readAsText(f);
  }

  async function run() {
    setBusy(true);
    try {
      const r = await posFetch<{ created: number; updated: number; skipped: number; errors: string[] }>("/api/admin/products/import", { method: "POST", body: JSON.stringify({ locationSlug: slug, rows }) });
      setResult(r);
      toast({ tone: "success", title: `Imported ${r.created + r.updated} products` });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  function close() { setRows([]); setFileName(null); setError(null); setResult(null); onClose(); }

  return (
    <Modal open={open} onClose={close} title="Import products from CSV" description="Columns: name, sku, price, category, inventory. Existing products are matched by SKU (or name) and updated." wide
      footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={close}>{result ? "Done" : "Cancel"}</Button>{!result && <Button onClick={() => void run()} disabled={!rows.length} loading={busy} iconLeft={<Upload className="h-4 w-4" />}>Import {rows.length ? `${rows.length} rows` : ""}</Button>}</div>}>
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-apple border border-dashed border-apple-border bg-apple-fill-secondary p-6 text-center text-apple-sm text-apple-text-secondary hover:border-apple-blue">
          <Upload className="mb-2 h-5 w-5" />
          {fileName ?? "Choose a .csv file"}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </label>
        {error && <p className="text-apple-sm text-apple-red">{error}</p>}
        {rows.length > 0 && !result && (
          <div className="max-h-64 overflow-auto rounded-apple border border-apple-border">
            <table className="w-full text-apple-xs">
              <thead className="bg-apple-fill-secondary text-left text-apple-text-tertiary"><tr><th className="px-2 py-1">Name</th><th className="px-2 py-1">SKU</th><th className="px-2 py-1">Price</th><th className="px-2 py-1">Category</th><th className="px-2 py-1">Inventory</th></tr></thead>
              <tbody>{rows.slice(0, 50).map((r, i) => <tr key={i} className="border-t border-apple-divider"><td className="px-2 py-1">{r.name}</td><td className="px-2 py-1">{r.sku}</td><td className="px-2 py-1">{r.price}</td><td className="px-2 py-1">{r.category}</td><td className="px-2 py-1">{r.inventory}</td></tr>)}</tbody>
            </table>
            {rows.length > 50 && <p className="p-2 text-apple-xs text-apple-text-tertiary">…and {rows.length - 50} more</p>}
          </div>
        )}
        {result && (
          <div className="rounded-apple border border-apple-green/30 bg-apple-green/5 p-4 text-apple-sm">
            <div><strong>{result.created}</strong> created · <strong>{result.updated}</strong> updated · <strong>{result.skipped}</strong> skipped</div>
            {result.errors.length > 0 && <ul className="mt-2 list-disc pl-5 text-apple-xs text-apple-text-secondary">{result.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}</ul>}
          </div>
        )}
      </div>
    </Modal>
  );
}
