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

function parseDate(val: string): Date | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function extractAllFields(body: any) {
  return {
    email: findField(body, "email", "emailAddress", "Email", "member_email", "memberEmail"),
    firstName: findField(body, "firstName", "first_name", "First Name", "first", "fname"),
    lastName: findField(body, "lastName", "last_name", "Last Name", "last", "lname"),
    fullName: findField(body, "fullName", "full_name", "name", "Full Name"),
    phone: findField(body, "phone", "phoneNumber", "Phone", "mobile", "cell", "member_phone"),
    dob: findField(body, "dob", "dateOfBirth", "date_of_birth", "birthday"),
    gender: findField(body, "gender", "Gender"),
    membershipType: findField(body, "membershipType", "membership_title", "membership", "plan", "membership_name", "membershipName"),
    membershipStartDate: findField(body, "membershipStartDate", "start_date", "startDate", "membership_start_date"),
    signupFee: findField(body, "signupFee", "signup_fee", "signupCost"),
    membershipFees: findField(body, "membershipFees", "membership_fees", "membershipAmount"),
    membershipRecurrence: findField(body, "membershipRecurrence", "membership_recurrence", "recurrence"),
    loginLink: findField(body, "loginLink", "login_link", "portalLink"),
    gymDeskId: findField(body, "gymDeskId", "member_id", "memberId", "id"),
  };
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
  } catch {}

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
  const fields = extractAllFields(body);

  if (!locationSlug || !fields.email) {
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

  const memberStatus = VALID_STATUSES.includes(statusOverride?.toUpperCase())
    ? statusOverride.toUpperCase()
    : "ACTIVE";

  const member = await getPrisma().member.upsert({
    where: {
      locationId_email: {
        locationId: location.id,
        email: fields.email.toLowerCase().trim(),
      },
    },
    update: {
      firstName: fields.firstName || undefined,
      lastName: fields.lastName || undefined,
      fullName: fields.fullName || undefined,
      phone: fields.phone || undefined,
      dob: parseDate(fields.dob) ?? undefined,
      gender: fields.gender || undefined,
      status: memberStatus,
      membershipType: fields.membershipType || undefined,
      membershipStartDate: parseDate(fields.membershipStartDate) ?? undefined,
      signupFee: fields.signupFee || undefined,
      membershipFees: fields.membershipFees || undefined,
      membershipRecurrence: fields.membershipRecurrence || undefined,
      loginLink: fields.loginLink || undefined,
      gymDeskId: fields.gymDeskId || undefined,
      source: "WEBHOOK",
    },
    create: {
      locationId: location.id,
      email: fields.email.toLowerCase().trim(),
      firstName: fields.firstName || "",
      lastName: fields.lastName || "",
      fullName: fields.fullName || null,
      phone: fields.phone || "",
      dob: parseDate(fields.dob),
      gender: fields.gender || null,
      status: memberStatus,
      membershipType: fields.membershipType || null,
      membershipStartDate: parseDate(fields.membershipStartDate),
      signupFee: fields.signupFee || null,
      membershipFees: fields.membershipFees || null,
      membershipRecurrence: fields.membershipRecurrence || null,
      loginLink: fields.loginLink || null,
      gymDeskId: fields.gymDeskId || null,
      source: "WEBHOOK",
    },
  });

  return NextResponse.json({ ok: true, memberId: member.id });
}

async function handleStatusChange(body: any, locationSlug: string, statusOverride: string) {
  const fields = extractAllFields(body);
  const status = statusOverride || findField(body, "status");

  if (!fields.email || !status) {
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

  const where: any = { email: fields.email.toLowerCase().trim() };

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

  const data: any = { status: upperStatus, source: "WEBHOOK" };
  if (fields.firstName) data.firstName = fields.firstName;
  if (fields.lastName) data.lastName = fields.lastName;
  if (fields.fullName) data.fullName = fields.fullName;
  if (fields.phone) data.phone = fields.phone;
  if (fields.dob) data.dob = parseDate(fields.dob);
  if (fields.gender) data.gender = fields.gender;
  if (fields.membershipType) data.membershipType = fields.membershipType;
  if (fields.membershipStartDate) data.membershipStartDate = parseDate(fields.membershipStartDate);
  if (fields.signupFee) data.signupFee = fields.signupFee;
  if (fields.membershipFees) data.membershipFees = fields.membershipFees;
  if (fields.membershipRecurrence) data.membershipRecurrence = fields.membershipRecurrence;
  if (fields.loginLink) data.loginLink = fields.loginLink;
  if (fields.gymDeskId) data.gymDeskId = fields.gymDeskId;

  const updated = await getPrisma().member.updateMany({
    where,
    data,
  });

  return NextResponse.json({ ok: true, updated: updated.count });
}
