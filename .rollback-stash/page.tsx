// app/manage/[...slug]/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const fmtTime = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

async function deleteBookingById(bookingId: string, token?: string | null) {
  "use server";
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  await fetch(`/api/bookings/${bookingId}${qs}`, { method: "DELETE", cache: "no-store" });
}

const BOOK_PAGE_PATH = "/book";

type PageProps = {
  params: { slug?: string[] };
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function ManageBookingPage({ params, searchParams = {} }: PageProps) {
  // Grab the first path segment after /manage as the bookingId
  const bookingId = Array.isArray(params?.slug) ? params!.slug![0] : undefined;

  // Accept token under either ?token or ?managementToken
  const manageToken =
    (searchParams?.token as string) ??
    (searchParams?.managementToken as string) ??
    null;

  if (!bookingId && !manageToken) {
    return (
      <main className="min-h-[100dvh] grid place-items-center p-6">
        <div className="max-w-xl w-full rounded-xl border p-6 bg-white">
          <h1 className="text-lg font-semibold mb-2">Missing Booking Info</h1>
          <p className="text-sm text-gray-600 mb-4">
            This link is missing a booking id or management token.
          </p>
          <div className="text-xs bg-gray-50 border rounded p-3 overflow-x-auto">
            <div className="font-semibold mb-1">Debug</div>
            <pre className="whitespace-pre-wrap">
{JSON.stringify({ params, searchParams }, null, 2)}
            </pre>
          </div>
          <div className="mt-4">
            <Link href="/" className="underline">Go home</Link>
          </div>
        </div>
      </main>
    );
  }

  // Look up by id when present; otherwise by unique managementToken
  const booking = await getPrisma().booking.findUnique({
    where: bookingId ? { id: bookingId } : { managementToken: manageToken! },
    include: { location: { select: { name: true, slug: true } } },
  });

  if (!booking) {
    return (
      <main className="min-h-[100dvh] grid place-items-center p-6">
        <div className="max-w-xl w-full rounded-xl border p-6 bg-white">
          <h1 className="text-lg font-semibold mb-2">Reservation Not Found</h1>
          <p className="text-sm text-gray-600">
            We couldn’t find a reservation with ID{" "}
            <span className="font-mono">{bookingId ?? "—"}</span>.
          </p>
          <div className="mt-4">
            <Link href="/" className="underline">Go home</Link>
          </div>
        </div>
      </main>
    );
  }

  // (Optional) Re-enable strict token enforcement later:
  // if (booking.managementToken && manageToken !== booking.managementToken) { ... }

  const { location, bayNumber, firstName, lastName, email } = booking as any;

  // Support either (start/end) or (startTime/endTime)
  const startRaw = (booking as any).start ?? (booking as any).startTime;
  const endRaw = (booking as any).end ?? (booking as any).endTime;
  const start = startRaw ? new Date(startRaw) : null;
  const end = endRaw ? new Date(endRaw) : null;

  return (
    <main className="min-h-[100dvh] bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Manage Your Reservation</h1>
          <p className="text-sm text-gray-500 mt-1">
            Booking ID: <span className="font-mono">{booking.id}</span>
          </p>
        </div>

        <div className="space-y-3 mb-6">
          <Row label="Name" value={`${firstName ?? ""} ${lastName ?? ""}`.trim() || "—"} />
          <Row label="Email" value={email || "—"} />
          <Row label="Location" value={location?.name ?? "—"} />
          <Row label="Bay" value={bayNumber ? `Bay ${bayNumber}` : "Any Available Bay"} />
          <Row label="Date" value={start ? fmtDate(start) : "—"} />
          <Row label="Time" value={start && end ? `${fmtTime(start)} – ${fmtTime(end)}` : "—"} />
        </div>

        <div className="mb-6 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 p-4 text-sm">
          <p className="leading-relaxed">
            <strong>Need to change your reservation?</strong> To modify your time, bay, or location,
            please delete your current reservation and make a new one.
          </p>
        </div>

        <form action={async () => { "use server"; await deleteBookingById(booking.id, manageToken); redirect("/"); }}>
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
          >
            Cancel Reservation
          </button>
        </form>

        <div className="h-3" />

        <form
          action={async () => {
            "use server";
            const slug = booking.location?.slug;
            await deleteBookingById(booking.id, manageToken);
            const to = slug ? `${BOOK_PAGE_PATH}?location=${encodeURIComponent(slug)}` : BOOK_PAGE_PATH;
            redirect(to);
          }}
        >
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white hover:opacity-90 transition"
          >
            Cancel Current Reservation and Re-Book
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-gray-500">
          <p>
            Accidentally canceled?{" "}
            <Link className="underline hover:no-underline" href={BOOK_PAGE_PATH}>
              Make a new reservation
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="text-gray-500 text-sm">{label}</div>
      <div className="text-gray-900 text-sm font-medium text-right">{value}</div>
    </div>
  );
}

