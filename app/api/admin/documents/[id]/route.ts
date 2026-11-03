import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin } from "@/lib/access";
import { getActorContext } from "@/lib/actor";
import { canInOrg } from "@/lib/org-scope";
import type { Permission } from "@/lib/permissions";
import { updateDocument } from "@/services/document.service";

export const dynamic = "force-dynamic";

function toSafeHtml(input: string, format: "text" | "html"): string {
  if (format === "text") {
    const esc = input.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
    return esc
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
      .join("\n");
  }
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

/**
 * Documents are org-level templates. A SCOPED admin must hold `permission`
 * for one of THEIR locations inside the document's organization (not merely
 * any location in that org).
 */
async function loadDoc(id: string, permission: Permission) {
  const admin = await getCurrentAdmin();
  if (!admin) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const doc = await getPrisma().document.findUnique({ where: { id } });
  if (!doc) return { ok: false as const, response: NextResponse.json({ error: "Document not found" }, { status: 404 }) };
  const actor = await getActorContext();
  if (!(await canInOrg(actor, permission, doc.organizationId))) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, admin, doc };
}

/** GET /api/admin/documents/[id] */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await loadDoc(id, "document.view-library");
  if (!g.ok) return g.response;
  return NextResponse.json({ ok: true, document: g.doc });
}

/**
 * PATCH /api/admin/documents/[id]
 * { name?, description?, body?, format?, requiredAtSignup?, expiresAfterDays?, graceAfterExpiryDays?, active? }
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await loadDoc(id, "document.create");
  if (!g.ok) return g.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const format: "text" | "html" = body.format === "html" ? "html" : "text";
  const expiresAfterDays =
    body.expiresAfterDays === undefined
      ? undefined
      : body.expiresAfterDays == null || body.expiresAfterDays === ""
        ? null
        : Math.max(1, Math.floor(Number(body.expiresAfterDays)) || 0) || null;
  const graceAfterExpiryDays =
    body.graceAfterExpiryDays === undefined
      ? undefined
      : Math.max(0, Math.floor(Number(body.graceAfterExpiryDays)) || 0);
  const doc = await updateDocument(
    id,
    {
      name: body.name != null ? String(body.name).trim() : undefined,
      description: body.description !== undefined ? (body.description ? String(body.description).trim() : null) : undefined,
      bodyHtml: body.body != null ? toSafeHtml(String(body.body), format) : undefined,
      requiredAtSignup: body.requiredAtSignup != null ? Boolean(body.requiredAtSignup) : undefined,
      expiresAfterDays,
      graceAfterExpiryDays,
      active: body.active != null ? Boolean(body.active) : undefined,
    },
    g.admin.id,
  );
  return NextResponse.json({ ok: true, document: { id: doc.id, name: doc.name, active: doc.active, version: doc.version } });
}
