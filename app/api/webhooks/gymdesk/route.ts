import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["ACTIVE", "CANCELLED", "FROZEN", "VISITOR"];

function authorize(req: NextRequest): boolean {
  const secret = process.env.GYMDESK_WEBHOOK_SECRET;
  if (!secret) return false;
  const qs = req.nextUrl.searchParams.get("secret");
  const header = req.headers.get("x-webhook-secret");
  return qs === secret || header === secret;
}

function findField(obj: any, ...keys: string[]): string {
  if (!obj || typeof obj !== "object") return "";
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      return String(obj[key]).trim();
    }
  }
  const lower = Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]/g, ""), v])
  );
  for (const key of keys) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (lower[normalized] !== undefined && lower[normalized] !== null && lower[normalized] !== "") {
      return String(lower[normalized]).trim();
    }
  }
  return "";
}

async function handleRequest(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const action = params.get("action") || "";
  const locationSlug = params.get("locationSlug") || params.get("location") || "";
  const statusParam = params.get("status") || "";

  let body: any = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    // Gymdesk may send form-encoded, empty body, or GET with no body
  }

  // For GET requests, also pull member fields from query params as fallback
  const allParams = Object.fromEntries(params.entries());
  const merged = { ...allParams, ...body };

  console.log("[Gymdesk webhook] method=%s action=%s locationSlug=%s status=%s data=%j", req.method, action, locationSlug, statusParam, merged);

  try {
    if (action === "new_member") {
      return await handleNewMember(merged, locationSlug, statusParam);
    } else if (action === "status_change") {
      return await handleStatusChange(merged, locationSlug, statusParam);
    } else {
      return NextResponse.json(
        { error: `Unknown action: ${action}. Use ?action=new_member or ?action=status_change` },
        { status: 400 }
      );
    }
  } catch (e: any) {
    console.error("[Gymdesk webhook] Error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handleRequest(req);
}

async function handleNewMember(body: any, locationSlug: string, statusOverride: string) {
  const email = findField(body, "email", "emailAddress", "Email", "member_email", "memberEmail");
  const firstName = findField(body, "firstName", "first_name", "First Name", "first", "fname");
  const lastName = findField(body, "lastName", "last_name", "Last Name", "last", "lname");
  const phone = findField(body, "phone", "phoneNumber", "Phone", "mobile", "cell", "member_phone");
  const membershipType = findField(body, "membershipType", "membership", "plan", "membership_name", "membershipName");
  const gymDeskId = findField(body, "id", "memberId", "member_id", "gymDeskId");

  if (!locationSlug || !email) {
    return NextResponse.json(
      { error: "locationSlug (in URL) and email (in body) are required" },
      { status: 400 }
    );
  }

  const location = await getPrisma().location.findUnique({
    where: { slug: locationSlug },
    select: { id: true },
  });
  if (!location) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 });
  }

  const memberStatus = VALID_STATUSES.includes(statusOverride?.toUpperCase())
    ? statusOverride.toUpperCase()
    : "ACTIVE";

  const member = await getPrisma().member.upsert({
    where: {
      locationId_email: {
        locationId: location.id,
        email: email.toLowerCase().trim(),
      },
    },
    update: {
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      phone: phone || undefined,
      status: memberStatus,
      membershipType: membershipType || undefined,
      gymDeskId: gymDeskId || undefined,
      source: "WEBHOOK",
    },
    create: {
      locationId: location.id,
      firstName: firstName || "",
      lastName: lastName || "",
      email: email.toLowerCase().trim(),
      phone: phone || "",
      status: memberStatus,
      membershipType: membershipType || null,
      gymDeskId: gymDeskId || null,
      source: "WEBHOOK",
    },
  });

  return NextResponse.json({ ok: true, memberId: member.id });
}

async function handleStatusChange(body: any, locationSlug: string, statusOverride: string) {
  const email = findField(body, "email", "emailAddress", "Email", "member_email", "memberEmail");
  const status = statusOverride || findField(body, "status");

  if (!email || !status) {
    return NextResponse.json(
      { error: "email (in body) and status (in URL ?status=) are required" },
      { status: 400 }
    );
  }

  const upperStatus = status.toUpperCase();
  if (!VALID_STATUSES.includes(upperStatus)) {
    return NextResponse.json(
      { error: `Invalid status: ${status}` },
      { status: 400 }
    );
  }

  const where: any = { email: email.toLowerCase().trim() };

  if (locationSlug) {
    const location = await getPrisma().location.findUnique({
      where: { slug: locationSlug },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }
    where.locationId = location.id;
  }

  const updated = await getPrisma().member.updateMany({
    where,
    data: { status: upperStatus, source: "WEBHOOK" },
  });

  return NextResponse.json({ ok: true, updated: updated.count });
}
