// app/api/admin/bookings/delete/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) return new NextResponse("Missing id", { status: 400 });

    await prisma.booking.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return new NextResponse("Not found", { status: 404 });
    }
    console.error("Delete booking error:", error);
    return new NextResponse(error?.message || "Failed to delete booking", { status: 500 });
  }
}
