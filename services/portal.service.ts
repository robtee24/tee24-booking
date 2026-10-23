// services/portal.service.ts
// Member-portal business logic: profile edits, membership self-service
// requests (cancel / freeze / change plan), signing-page loading + merge
// fields, and the membership-card payload. Everything here is member-scoped —
// callers must have already resolved the member from the portal session
// (or, for signing, from the token itself).
import { getPrisma } from "@/lib/db";
import { membershipDisplayName } from "@/lib/membership-pricing";
import { audit } from "@/lib/audit";
import { adminNotify } from "@/lib/admin-notify";
import { adminRoutes } from "@/lib/admin/routes";
import { emitMemberEvent } from "@/lib/events";
import { updateMember, type UpdateMemberInput } from "@/services/member.service";
import { signDocument } from "@/services/document.service";
import { renderTemplate } from "@/lib/template";

export class PortalError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "PortalError";
  }
}

/* ────────────────────────────── Profile ───────────────────────────────── */

export type ProfilePatch = Partial<{
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob: string | null;
  gender: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  guardianName: string | null;
}>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown, max = 200): string {
  return String(v ?? "").trim().slice(0, max);
}
function opt(v: unknown, max = 200): string | null {
  const s = str(v, max);
  return s ? s : null;
}

/** Members may edit contact + address fields only; status/plan/location stay admin-only. */
export async function updateOwnProfile(memberId: string, raw: Record<string, unknown>) {
  const patch: UpdateMemberInput = {};
  if (raw.firstName !== undefined) {
    const v = str(raw.firstName, 80);
    if (!v) throw new PortalError("First name is required");
    patch.firstName = v;
  }
  if (raw.lastName !== undefined) {
    const v = str(raw.lastName, 80);
    if (!v) throw new PortalError("Last name is required");
    patch.lastName = v;
  }
  if (raw.email !== undefined) {
    const v = str(raw.email, 254).toLowerCase();
    if (!EMAIL_RE.test(v)) throw new PortalError("Email address is invalid");
    const dup = await getPrisma().member.findFirst({ where: { email: v, id: { not: memberId }, mergedIntoId: null }, select: { id: true } });
    if (dup) throw new PortalError("That email is already in use on another account");
    patch.email = v;
  }
  if (raw.phone !== undefined) {
    const digits = str(raw.phone, 32).replace(/[^\d+]/g, "");
    if (digits.replace(/\D/g, "").length < 10) throw new PortalError("Phone number looks too short");
    patch.phone = digits.startsWith("+") ? digits : `+1${digits.replace(/\D/g, "").slice(-10)}`;
  }
  if (raw.dob !== undefined) {
    if (raw.dob === null || raw.dob === "") patch.dob = null;
    else {
      const d = new Date(String(raw.dob));
      if (Number.isNaN(d.getTime()) || d > new Date()) throw new PortalError("Date of birth is invalid");
      patch.dob = d;
    }
  }
  if (raw.gender !== undefined) patch.gender = opt(raw.gender, 40);
  for (const k of ["addressLine1", "addressLine2", "city", "state", "zip"] as const) if (raw[k] !== undefined) patch[k] = opt(raw[k], 120);
  if (raw.country !== undefined) patch.country = opt(raw.country, 2)?.toUpperCase() ?? null;

  const updated = await updateMember(memberId, patch, memberId);

  // guardianName isn't part of UpdateMemberInput; set it directly when present.
  if (raw.guardianName !== undefined) {
    await getPrisma().member.update({ where: { id: memberId }, data: { guardianName: opt(raw.guardianName, 120) } });
  }
  void audit({ actorId: memberId, actorRole: "MEMBER", action: "member.update", entityType: "Member", entityId: memberId, after: patch as Record<string, unknown>, metadata: { via: "portal" } });
  return updated;
}

/* ───────────────────────────── Membership ─────────────────────────────── */

export async function getMembershipOverview(memberId: string) {
  const prisma = getPrisma();
  const [sub, openInvoice, lastPaid, history] = await Promise.all([
    prisma.membershipSubscription.findFirst({
      where: { memberId, status: { in: ["ACTIVE", "CANCEL_SCHEDULED", "FROZEN", "COMP", "PENDING"] } },
      include: { plan: { select: { id: true, name: true, description: true, billingCadence: true, productType: true, cancellationPolicy: true, freezePolicy: true, guestAddonCents: true, maxGuests: true, dayPassGuestPricing: true } } },
      orderBy: { startDate: "desc" },
    }),
    prisma.invoice.findFirst({
      where: { memberId, status: { in: ["SCHEDULED", "PAST_DUE", "FAILED"] } },
      orderBy: { dueDate: "asc" },
      select: { id: true, number: true, status: true, dueDate: true, totalCents: true, payToken: true, description: true },
    }),
    prisma.invoice.findFirst({ where: { memberId, status: "PAID" }, orderBy: { paidAt: "desc" }, select: { paidAt: true, totalCents: true } }),
    prisma.membershipSubscription.findMany({
      where: { memberId },
      orderBy: { startDate: "desc" },
      take: 6,
      select: { id: true, status: true, startDate: true, endDate: true, guestCount: true, plan: { select: { name: true, productType: true } } },
    }),
  ]);
  const plans = await prisma.membershipPlan.findMany({
    where: { archived: false, category: "MEMBER", productType: "RECURRING" },
    orderBy: { priceCents: "asc" },
    select: { id: true, name: true, priceCents: true, billingCadence: true, description: true },
  });
  const pendingPlan = sub?.pendingPlanId ? await prisma.membershipPlan.findUnique({ where: { id: sub.pendingPlanId }, select: { name: true, productType: true } }) : null;
  const pendingChange =
    sub?.pendingPlanId && sub.pendingChangeAt && sub.pendingGuestCount != null && sub.pendingPriceCents != null
      ? {
          planId: sub.pendingPlanId,
          planName: pendingPlan?.name ?? "New plan",
          displayName: membershipDisplayName(pendingPlan?.name ?? "New plan", sub.pendingGuestCount, pendingPlan?.productType),
          guestCount: sub.pendingGuestCount,
          priceCents: sub.pendingPriceCents,
          effectiveAt: sub.pendingChangeAt.toISOString(),
        }
      : null;
  return { sub, openInvoice, lastPaid, history, plans, pendingChange };
}

type RequestKind = "cancel" | "freeze" | "change-plan";

/**
 * Self-service requests never change billing directly — they stamp the
 * subscription (cancel only), open a Task for staff, and raise an
 * AdminNotification at the member's location.
 */
export async function submitMembershipRequest(memberId: string, kind: RequestKind, input: { reason?: string; resumeDate?: string; targetPlanId?: string }) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, locationId: true, organizationId: true, location: { select: { slug: true, name: true } } },
  });
  if (!member) throw new PortalError("Member not found", 404);
  const sub = await prisma.membershipSubscription.findFirst({
    where: { memberId, status: { in: ["ACTIVE", "CANCEL_SCHEDULED", "FROZEN", "COMP"] } },
    include: { plan: { select: { name: true, productType: true } } },
    orderBy: { startDate: "desc" },
  });
  if (!sub) throw new PortalError("You don't have an active membership");
  const reason = opt(input.reason, 1000);
  const name = `${member.firstName} ${member.lastName}`.trim();
  const profileUrl = adminRoutes.loc.members.detailTab(member.location.slug, member.id, "memberships");

  let title = "";
  let body = "";
  let notifKind = "";
  let targetPlanName: string | null = null;

  if (kind === "cancel") {
    if (sub.cancelRequestedAt && !sub.cancelledAt) throw new PortalError("A cancellation request is already pending");
    await prisma.membershipSubscription.update({ where: { id: sub.id }, data: { cancelRequestedAt: new Date(), cancelRequestReason: reason } });
    title = `Cancellation request · ${name}`;
    body = `${name} asked to cancel ${membershipDisplayName(sub.plan.name, sub.guestCount, sub.plan.productType)}.${reason ? `\nReason: ${reason}` : ""}\nPhone ${member.phone} · ${member.email}`;
    notifKind = "membership.cancel_requested";
  } else if (kind === "freeze") {
    const resume = input.resumeDate ? new Date(input.resumeDate) : null;
    if (resume && Number.isNaN(resume.getTime())) throw new PortalError("Resume date is invalid");
    title = `Freeze request · ${name}`;
    body = `${name} asked to freeze ${membershipDisplayName(sub.plan.name, sub.guestCount, sub.plan.productType)}${resume ? ` until ${resume.toLocaleDateString()}` : ""}.${reason ? `\nReason: ${reason}` : ""}\nPhone ${member.phone} · ${member.email}`;
    notifKind = "membership.freeze_requested";
  } else {
    const plan = input.targetPlanId ? await prisma.membershipPlan.findFirst({ where: { id: input.targetPlanId, archived: false }, select: { name: true } }) : null;
    if (!plan) throw new PortalError("Pick a plan to switch to");
    targetPlanName = plan.name;
    title = `Plan change request · ${name}`;
    body = `${name} asked to switch from ${membershipDisplayName(sub.plan.name, sub.guestCount, sub.plan.productType)} to ${plan.name}.${reason ? `\nNote: ${reason}` : ""}\nPhone ${member.phone} · ${member.email}`;
    notifKind = "membership.change_requested";
  }

  const task = await prisma.task.create({
    data: {
      organizationId: member.organizationId,
      locationId: member.locationId,
      memberId: member.id,
      title,
      body,
      priority: kind === "cancel" ? "HIGH" : "NORMAL",
      dueAt: new Date(Date.now() + 2 * 86_400_000),
      status: "OPEN",
    },
  });

  await adminNotify({
    organizationId: member.organizationId ?? undefined,
    locationId: member.locationId,
    kind: notifKind,
    severity: kind === "cancel" ? "WARN" : "INFO",
    title,
    body: body.split("\n")[0],
    link: profileUrl,
    data: { memberId: member.id, subscriptionId: sub.id, taskId: task.id, reason, targetPlanName, resumeDate: input.resumeDate ?? null },
  });

  void audit({
    organizationId: member.organizationId,
    actorId: memberId,
    actorRole: "MEMBER",
    action: kind === "cancel" ? "membership.cancel-schedule" : kind === "freeze" ? "membership.freeze" : "membership.plan-change",
    entityType: "MembershipSubscription",
    entityId: sub.id,
    metadata: { via: "portal", request: kind, reason, targetPlanName, taskId: task.id, locationId: member.locationId },
  });

  return { taskId: task.id };
}

/* ─────────────────────────── Membership card ──────────────────────────── */

export async function getMembershipCard(memberId: string) {
  const prisma = getPrisma();
  const m = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      photoUrl: true,
      status: true,
      checkinCode: true,
      joinDate: true,
      createdAt: true,
      location: { select: { name: true, slug: true, logoUrl: true, businessName: true } },
      membershipSubscriptions: {
        where: { status: { in: ["ACTIVE", "CANCEL_SCHEDULED", "FROZEN", "COMP"] } },
        orderBy: { startDate: "desc" },
        take: 1,
        select: { status: true, paidThroughDate: true, endDate: true, guestCount: true, plan: { select: { name: true, productType: true } } },
      },
    },
  });
  if (!m) throw new PortalError("Member not found", 404);
  const sub = m.membershipSubscriptions[0] ?? null;
  return {
    memberId: m.id,
    name: `${m.firstName} ${m.lastName}`.trim(),
    photoUrl: m.photoUrl,
    status: m.status,
    checkinCode: m.checkinCode,
    memberSince: m.joinDate ?? m.createdAt,
    location: m.location,
    plan: sub ? membershipDisplayName(sub.plan.name, sub.guestCount, sub.plan.productType) : null,
    planStatus: sub?.status ?? null,
    validThrough: sub?.paidThroughDate ?? sub?.endDate ?? null,
    qrPayload: `tee24:member:${m.id}`,
  };
}

/* ───────────────────────────── Signing ────────────────────────────────── */

export type SigningView = {
  state: "ready" | "signed" | "expired" | "invalid";
  assignmentId?: string;
  documentName?: string;
  description?: string | null;
  bodyHtml?: string;
  memberId?: string;
  memberName?: string;
  isMinor?: boolean;
  signedAt?: Date | null;
  expiresAt?: Date | null;
  locationName?: string | null;
};

function ageOn(dob: Date | null, at = new Date()) {
  if (!dob) return null;
  let a = at.getFullYear() - dob.getFullYear();
  const m = at.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < dob.getDate())) a--;
  return a;
}

/** Very small allow-list sanitiser: strips scripts/handlers from stored HTML before we render it. */
export function sanitizeDocHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(iframe|object|embed|form|input|button)[\s\S]*?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

export async function loadSigningView(token: string, opts: { markViewed?: boolean } = {}): Promise<SigningView> {
  const prisma = getPrisma();
  const a = await prisma.documentAssignment.findUnique({
    where: { signingToken: token },
    include: {
      document: { select: { name: true, description: true, bodyHtml: true } },
      member: {
        select: {
          id: true, firstName: true, lastName: true, email: true, phone: true, dob: true, guardianName: true, addressLine1: true, city: true, state: true, zip: true,
          location: { select: { name: true, businessName: true } },
          emergencyContacts: { where: { isEmergency: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { name: true, phone: true, relationship: true } },
        },
      },
    },
  });
  if (!a) return { state: "invalid" };
  const now = new Date();
  const memberName = `${a.member.firstName} ${a.member.lastName}`.trim();
  if (a.status === "SIGNED") return { state: "signed", assignmentId: a.id, documentName: a.document.name, memberName, signedAt: a.signedAt, locationName: a.member.location?.name };
  if (a.status === "VOIDED" || a.status === "EXPIRED" || a.status === "DECLINED" || (a.expiresAt && a.expiresAt < now)) {
    return { state: "expired", assignmentId: a.id, documentName: a.document.name, memberName, expiresAt: a.expiresAt, locationName: a.member.location?.name };
  }

  if (opts.markViewed && a.status === "SENT") {
    await prisma.documentAssignment.update({ where: { id: a.id }, data: { status: "VIEWED" } }).catch(() => {});
    await prisma.signatureEvent.create({ data: { assignmentId: a.id, memberId: a.memberId, kind: "VIEWED" } }).catch(() => {});
  }

  const vars: Record<string, string> = {
    firstName: a.member.firstName,
    lastName: a.member.lastName,
    fullName: memberName,
    memberName,
    email: a.member.email,
    phone: a.member.phone,
    dob: a.member.dob ? a.member.dob.toLocaleDateString() : "",
    address: [a.member.addressLine1, a.member.city, a.member.state, a.member.zip].filter(Boolean).join(", "),
    guardianName: a.member.guardianName ?? "",
    contactName: a.member.emergencyContacts?.[0]?.name ?? "",
    contactPhone: a.member.emergencyContacts?.[0]?.phone ?? "",
    contactRelation: a.member.emergencyContacts?.[0]?.relationship ?? "",
    locationName: a.member.location?.name ?? "Tee24",
    businessName: a.member.location?.businessName ?? a.member.location?.name ?? "Tee24",
    date: now.toLocaleDateString(),
    today: now.toLocaleDateString(),
    documentName: a.document.name,
  };
  // Templates use {{key}} (lib/template) but Document.bodyHtml is documented as {field} — support both.
  let html = renderTemplate(a.document.bodyHtml ?? "", vars);
  html = html.replace(/\{([a-zA-Z_]+)\}/g, (m, k: string) => (k in vars ? vars[k]! : m));

  const age = ageOn(a.member.dob, now);
  return {
    state: "ready",
    assignmentId: a.id,
    documentName: a.document.name,
    description: a.document.description,
    bodyHtml: sanitizeDocHtml(html),
    memberId: a.member.id,
    memberName,
    isMinor: age !== null && age < 18,
    expiresAt: a.expiresAt,
    locationName: a.member.location?.name,
  };
}

export type SignInput = {
  token: string;
  typedName: string;
  signatureDataUrl: string; // SVG or PNG data URL from the pad
  initialsDataUrl?: string | null;
  guardianName?: string | null;
  consent: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function signFromPortal(input: SignInput) {
  const prisma = getPrisma();
  if (!input.consent) throw new PortalError("You must agree to sign electronically");
  const typedName = str(input.typedName, 120);
  if (typedName.length < 2) throw new PortalError("Type your full legal name");
  if (!/^data:image\/(svg\+xml|png);base64,[A-Za-z0-9+/=]+$/.test(input.signatureDataUrl) || input.signatureDataUrl.length > 400_000) {
    throw new PortalError("Signature is missing or invalid");
  }
  if (input.initialsDataUrl && (!/^data:image\/(svg\+xml|png);base64,[A-Za-z0-9+/=]+$/.test(input.initialsDataUrl) || input.initialsDataUrl.length > 200_000)) {
    throw new PortalError("Initials are invalid");
  }

  const a = await prisma.documentAssignment.findUnique({
    where: { signingToken: input.token },
    include: { member: { select: { id: true, dob: true, locationId: true, organizationId: true, guardianName: true } }, document: { select: { name: true, requiredAtSignup: true } } },
  });
  if (!a) throw new PortalError("This signing link is invalid", 404);
  if (a.status === "SIGNED") throw new PortalError("This document is already signed", 409);
  if (a.status === "VOIDED" || a.status === "EXPIRED" || (a.expiresAt && a.expiresAt < new Date())) throw new PortalError("This signing link has expired", 410);

  const minor = (() => {
    const age = ageOn(a.member.dob);
    return age !== null && age < 18;
  })();
  const guardianName = opt(input.guardianName, 120);
  if (minor && !guardianName) throw new PortalError("A parent or guardian's name is required for members under 18");
  if (guardianName && guardianName !== a.member.guardianName) {
    await prisma.member.update({ where: { id: a.member.id }, data: { guardianName } }).catch(() => {});
  }

  // Wrap the drawn signature with the typed name so the stored SVG is self-describing.
  const signatureSvg = wrapSignatureSvg(input.signatureDataUrl, typedName, guardianName);
  const initialsSvg = input.initialsDataUrl ? wrapSignatureSvg(input.initialsDataUrl, typedName.split(/\s+/).map((p) => p[0]).join("").toUpperCase(), null) : undefined;

  const signed = await signDocument({
    signingToken: input.token,
    signatureSvg,
    initialsSvg,
    ipAddress: input.ipAddress ?? undefined,
    userAgent: input.userAgent ?? undefined,
  });

  await emitMemberEvent("document.signed", {
    memberId: a.member.id,
    locationId: a.member.locationId,
    organizationId: a.member.organizationId,
    refs: { assignmentId: a.id },
    vars: { documentName: a.document.name, signedAt: new Date().toISOString(), typedName, guardianName },
  });

  return { assignmentId: signed.id, signedAt: signed.signedAt, documentName: a.document.name };
}

/** Embeds the raster/vector capture in an SVG with a caption (name + timestamp). */
function wrapSignatureSvg(dataUrl: string, caption: string, guardian: string | null): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const stamp = new Date().toISOString();
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="160" viewBox="0 0 400 160">` +
    `<rect width="400" height="160" fill="#fff"/>` +
    `<image href="${dataUrl}" x="10" y="8" width="380" height="110" preserveAspectRatio="xMidYMid meet"/>` +
    `<line x1="20" y1="122" x2="380" y2="122" stroke="#999" stroke-width="1"/>` +
    `<text x="20" y="140" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#111">${esc(caption)}${guardian ? ` (guardian: ${esc(guardian)})` : ""}</text>` +
    `<text x="20" y="154" font-family="Helvetica, Arial, sans-serif" font-size="9" fill="#666">Signed electronically ${esc(stamp)}</text>` +
    `</svg>`
  );
}
