import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin, canAccessLocation } from "@/lib/access";
import { createDocument } from "@/services/document.service";

export const dynamic = "force-dynamic";

/** Minimal HTML allow-list: strip scripts/handlers; escape plain text input. */
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

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const locationSlug = String(body?.locationSlug ?? "");
  const name = String(body?.name ?? "").trim();
  const rawBody = String(body?.body ?? "");
  const format: "text" | "html" = body?.format === "html" ? "html" : "text";

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!rawBody.trim()) return NextResponse.json({ error: "Document body is required" }, { status: 400 });

  const location = await getPrisma().location.findUnique({
    where: { slug: locationSlug },
    select: { id: true, organizationId: true },
  });
  if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });
  if (!canAccessLocation(admin.role, admin.locations.map((l) => l.locationId), location.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const expiresAfterDays = body?.expiresAfterDays == null || body.expiresAfterDays === "" ? null : Math.max(1, Math.floor(Number(body.expiresAfterDays)) || 0) || null;
  const graceAfterExpiryDays = body?.graceAfterExpiryDays == null || body.graceAfterExpiryDays === "" ? 7 : Math.max(0, Math.floor(Number(body.graceAfterExpiryDays)) || 0);

  const doc = await createDocument(
    {
      organizationId: location.organizationId,
      name,
      description: body?.description ? String(body.description).trim() || null : null,
      bodyHtml: toSafeHtml(rawBody, format),
      requiredAtSignup: Boolean(body?.requiredAtSignup),
      expiresAfterDays,
      graceAfterExpiryDays,
    },
    admin.id
  );

  return NextResponse.json({ ok: true, document: { id: doc.id, name: doc.name } });
}
