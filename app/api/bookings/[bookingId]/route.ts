// app/api/bookings/[bookingId]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/bookings/[bookingId]
 * Returns the booking (with location) or 404 if not found.
 * Next 16: context.params is a Promise<{ bookingId: string }>
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await context.params;

  const booking = await getPrisma().booking.findUnique({
    where: { id: bookingId },
    include: { Location: { select: { name: true, slug: true } } }, // 👈 only change
  });

  if (!booking) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(booking, { status: 200 });
}

/**
 * DELETE /api/bookings/[bookingId]?token=...
 * Hard-deletes the booking (preserves your current behavior).
 * If a per-booking management token exists, it must match ?token.
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await context.params;
  const token = req.nextUrl.searchParams.get("token") || undefined;

  // Enforce per-booking management token if present
  const b = await getPrisma().booking.findUnique({
    where: { id: bookingId },
    select: { id: true, managementToken: true },
  });

  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (b.managementToken && b.managementToken !== token)
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  // Optional: clean up any queued notifications
  // await getPrisma().notification.deleteMany({ where: { bookingId } });

  await getPrisma().booking.delete({ where: { id: bookingId } });
  return NextResponse.json({ ok: true });
}

