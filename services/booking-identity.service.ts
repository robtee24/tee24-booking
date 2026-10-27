import { getPrisma } from "@/lib/db";
import { getBookingAccess, GUEST_PLAY_FEE_CENTS, UNAUTHORIZED_GUEST_FEE_CENTS } from "@/services/mobile-booking-access.service";
import { toE164 } from "@/lib/phone";

const GILMORE_NAME = /gilmore/i;
const GILMORE_NOT_RANGE = /driving range/i;

export async function lookupBookingIdentity(rawPhone: string, locationSlug: string | null) {
  const prisma = getPrisma();
  let phone = rawPhone;
  try {
    phone = toE164(rawPhone);
  } catch {
    /* keep raw */
  }
  const digits = phone.replace(/\D/g, "").slice(-10);

  const member = digits
    ? await prisma.member.findFirst({
        where: { phone: { contains: digits }, mergedIntoId: null, status: { not: "CANCELLED" } },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, locationId: true },
        orderBy: { createdAt: "desc" },
      })
    : null;

  const location = locationSlug
    ? await prisma.location.findUnique({
        where: { slug: locationSlug },
        select: { id: true, slug: true, name: true },
      })
    : member?.locationId
      ? await prisma.location.findUnique({ where: { id: member.locationId }, select: { id: true, slug: true, name: true } })
      : null;

  const form = location
    ? await prisma.signupForm.findFirst({
        where: { locationId: location.id, slug: location.slug },
        select: { slug: true, active: true, allowedPlanIds: true },
      })
    : null;

  const plans = await prisma.membershipPlan.findMany({
    where: { archived: false, productType: { in: ["RECURRING", "DAY_PASS", "ONE_OFF"] } },
    select: { id: true, name: true, productType: true, priceCents: true, maxGuests: true },
    orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }],
  });
  const gilmore = plans.find((p) => GILMORE_NAME.test(p.name) && !GILMORE_NOT_RANGE.test(p.name) && p.productType === "DAY_PASS") ?? plans.find((p) => GILMORE_NAME.test(p.name));

  const access = member ? await getBookingAccess(member.id) : null;

  return {
    phone,
    member: member
      ? {
          id: member.id,
          firstName: member.firstName,
          lastName: member.lastName,
          email: member.email,
          phone: member.phone,
        }
      : null,
    access,
    guest: {
      extraFeeCents: GUEST_PLAY_FEE_CENTS,
      unauthorizedFeeCents: UNAUTHORIZED_GUEST_FEE_CENTS,
      gilmorePlanId: gilmore?.id ?? null,
      gilmoreName: gilmore?.name ?? "The Gilmore",
      gilmorePriceCents: gilmore?.priceCents ?? 5000,
      // Unpublished forms are reachable at /signup-staging until they are switched on in admin.
      signupPath: form ? `${form.active ? "/signup" : "/signup-staging"}/${form.slug}` : location ? `/daypass/${location.slug}` : "/daypass",
      plans: plans.map((p) => ({ id: p.id, name: p.name, productType: p.productType, priceCents: p.priceCents })),
    },
  };
}
