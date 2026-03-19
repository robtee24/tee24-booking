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

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const action = body.action as string;

    if (action === "new_member") {
      return await handleNewMember(body);
    } else if (action === "status_change") {
      return await handleStatusChange(body);
    } else {
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
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

async function handleNewMember(body: any) {
  const { locationSlug, firstName, lastName, email, phone, status, membershipType, gymDeskId } = body;

  if (!locationSlug || !email) {
    return NextResponse.json(
      { error: "locationSlug and email are required" },
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

  const memberStatus = VALID_STATUSES.includes(status?.toUpperCase())
    ? status.toUpperCase()
    : "ACTIVE";

  const member = await getPrisma().member.upsert({
    where: {
      locationId_email: {
        locationId: location.id,
        email: email.toLowerCase().trim(),
      },
    },
    update: {
      firstName: firstName?.trim() || undefined,
      lastName: lastName?.trim() || undefined,
      phone: phone?.trim() || undefined,
      status: memberStatus,
      membershipType: membershipType || undefined,
      gymDeskId: gymDeskId || undefined,
      source: "ZAPIER",
    },
    create: {
      locationId: location.id,
      firstName: (firstName || "").trim(),
      lastName: (lastName || "").trim(),
      email: email.toLowerCase().trim(),
      phone: (phone || "").trim(),
      status: memberStatus,
      membershipType: membershipType || null,
      gymDeskId: gymDeskId || null,
      source: "ZAPIER",
    },
  });

  return NextResponse.json({ ok: true, memberId: member.id });
}

async function handleStatusChange(body: any) {
  const { locationSlug, email, status } = body;

  if (!email || !status) {
    return NextResponse.json(
      { error: "email and status are required" },
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
