#!/usr/bin/env node
/**
 * Build-time guard against dead admin links.
 *
 * 1. Loads `lib/admin/routes.ts` (transpiled in-memory with the TypeScript API),
 *    enumerates every route + nav entry, and asserts a `page.tsx` exists for it
 *    under `app/` (dynamic segments like `[slug]` are honoured).
 * 2. Scans admin source for hard-coded static "/admin/..." href strings and
 *    verifies those resolve too (template literals are skipped — use adminRoutes).
 *
 * Runs on `npm run prebuild`, so a missing page fails the Vercel build instead of
 * shipping a 404. Run manually: `node scripts/verify-admin-routes.mjs`
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(ROOT, "app");
const ROUTES_TS = path.join(ROOT, "lib", "admin", "routes.ts");

// ── 1. Load the registry ────────────────────────────────────────────────────
function loadRoutesModule() {
  const src = fs.readFileSync(ROUTES_TS, "utf8");
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: ROUTES_TS,
  });
  const mod = { exports: {} };
  const fn = new Function("module", "exports", "require", outputText);
  fn(mod, mod.exports, require);
  return mod.exports;
}

// ── 2. Resolve a URL path to an app-router page file ────────────────────────
const PAGE_FILES = ["page.tsx", "page.ts", "page.jsx", "page.js"];

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function hasPage(dir) {
  return PAGE_FILES.some((f) => fs.existsSync(path.join(dir, f)));
}

/**
 * Depth-first match of URL segments against the app directory, honouring
 * route groups "(group)", dynamic "[param]" and catch-all "[...rest]".
 * Returns the matched page directory or null.
 */
function resolvePage(dir, segments) {
  // Route groups are transparent — try descending into them at every level.
  const groups = listDirs(dir).filter((d) => d.startsWith("(") && d.endsWith(")"));

  if (segments.length === 0) {
    if (hasPage(dir)) return dir;
    for (const g of groups) {
      const r = resolvePage(path.join(dir, g), segments);
      if (r) return r;
    }
    return null;
  }

  const [head, ...rest] = segments;
  const dirs = listDirs(dir);

  // Exact static match first
  if (dirs.includes(head)) {
    const r = resolvePage(path.join(dir, head), rest);
    if (r) return r;
  }
  // Dynamic single segment
  for (const d of dirs) {
    if (/^\[[^.\]]+\]$/.test(d)) {
      const r = resolvePage(path.join(dir, d), rest);
      if (r) return r;
    }
  }
  // Route groups
  for (const g of groups) {
    const r = resolvePage(path.join(dir, g), segments);
    if (r) return r;
  }
  // Catch-all (we treat the admin catch-all as a valid *404 page*, not a real
  // route — so a registry route that only resolves via catch-all is a failure).
  return null;
}

function checkPath(urlPath) {
  const clean = urlPath.split("?")[0].split("#")[0];
  const segments = clean.split("/").filter(Boolean);
  return resolvePage(APP_DIR, segments);
}

// ── 3. Scan for hard-coded static admin hrefs ───────────────────────────────
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(p, out);
    } else if (/\.(tsx|ts|jsx|js)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function scanStaticHrefs() {
  const files = [
    ...walk(path.join(ROOT, "app", "admin")),
    ...walk(path.join(ROOT, "components")),
  ];
  const found = new Map(); // path -> [file]
  const re = /(?:href|push|replace|redirect)\(?\s*=?\s*["'](\/admin\/[^"'`${}\s]*)["']/g;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    let m;
    while ((m = re.exec(src))) {
      const p = m[1];
      if (!found.has(p)) found.set(p, []);
      found.get(p).push(path.relative(ROOT, f));
    }
  }
  return found;
}

// ── Run ─────────────────────────────────────────────────────────────────────
const routes = loadRoutesModule();
const registryPaths = routes.enumerateRoutePaths();

const failures = [];
for (const p of registryPaths) {
  if (!checkPath(p)) failures.push({ path: p, source: "lib/admin/routes.ts" });
}

const staticHrefs = scanStaticHrefs();
for (const [p, files] of staticHrefs) {
  if (!checkPath(p)) failures.push({ path: p, source: files.join(", ") });
}

const checked = registryPaths.length + staticHrefs.size;
if (failures.length) {
  console.error(`\n✖ verify-admin-routes: ${failures.length} admin link(s) have no page.tsx:\n`);
  for (const f of failures) console.error(`   ${f.path}\n      ← ${f.source}`);
  console.error("\nAdd the missing page, or fix the route in lib/admin/routes.ts.\n");
  process.exit(1);
}

console.log(`✔ verify-admin-routes: ${checked} admin routes resolve to a page.`);
