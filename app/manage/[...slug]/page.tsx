// app/manage/[...slug]/page.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type ParamsType = { slug?: string[] };
type SearchParamsType = Record<string, string | string[]>;

function getBookingIdFromSlug(slug: string[] | undefined) {
  if (!slug || slug.length === 0) return "";
  if (slug[0] === "booking" && slug[1]) return slug[1];
  return slug[0];
}

type ApiBooking = {
  id: string;
  start?: string | Date;
  end?: string | Date;
  bayNumber?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: { slug?: string; name?: string };
  Location?: { slug?: string; name?: string };
};

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function ManageBookingPage(props: {
  params: Promise<ParamsType>;
  searchParams: Promise<SearchParamsType>;
}) {
  const params = (React as any).use(props.params) as ParamsType;
  const searchParams = (React as any).use(props.searchParams) as SearchParamsType;

  const router = useRouter();

  const bookingId = React.useMemo(() => getBookingIdFromSlug(params?.slug), [params]);

  const token = React.useMemo(() => {
    const sp = searchParams?.token;
    if (Array.isArray(sp)) return sp[0] ?? "";
    if (typeof sp === "string") return sp;
    try {
      const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const direct = q.get("token");
      if (direct) return direct;
    } catch {}
    return "";
  }, [searchParams]);

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showModal, setShowModal] = React.useState(false);
  const [locationSlug, setLocationSlug] = React.useState<string | null>(null);

  const [booking, setBooking] = React.useState<ApiBooking | null>(null);
  const [bookingLoadError, setBookingLoadError] = React.useState<string | null>(null);
  const [bookingLoading, setBookingLoading] = React.useState<boolean>(true);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setBookingLoading(true);
      setBookingLoadError(null);
      setBooking(null);
      if (!bookingId) { setBookingLoading(false); return; }
      try {
        const res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setBookingLoadError(res.status === 404 ? "Reservation not found." : `HTTP ${res.status}`);
          return;
        }
        const data: ApiBooking = await res.json();
        const loc = data.location ?? (data as any).Location ?? {};
        if (!cancelled) { setLocationSlug(loc?.slug ?? null); setBooking(data); }
      } catch (e: any) {
        if (!cancelled) setBookingLoadError(e?.message || "Failed to load reservation.");
      } finally {
        if (!cancelled) setBookingLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [bookingId]);

  const cancelReservation = React.useCallback(async () => {
    if (!bookingId) { setError("Missing booking id."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/bookings/${encodeURIComponent(bookingId)}?token=${encodeURIComponent(token)}`,
        { method: "DELETE", cache: "no-store" }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Cancel failed (HTTP ${res.status})`);
      }
      setShowModal(true);
    } catch (e: any) {
      setError(e?.message || "Failed to cancel reservation.");
    } finally {
      setLoading(false);
    }
  }, [bookingId, token]);

  const gotoNewReservation = React.useCallback(() => {
    if (locationSlug) router.replace(`/book/${encodeURIComponent(locationSlug)}`);
    else router.replace(`/book`);
  }, [router, locationSlug]);

  const locationName = (booking?.location?.name ?? (booking as any)?.Location?.name ?? "") || "";
  const bay = booking?.bayNumber ?? "—";
  const startDate = booking?.start ? new Date(booking.start) : null;
  const endDate = booking?.end ? new Date(booking.end) : null;
  const dateStr = startDate ? fmtDate(startDate) : "—";
  const timeStr = startDate && endDate ? `${fmtTime(startDate)} – ${fmtTime(endDate)}` : "—";
  const guestName = [booking?.firstName, booking?.lastName].filter(Boolean).join(" ").trim();
  const guestContact = booking?.email || booking?.phone || "";

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-apple-2xl font-semibold tracking-tight text-apple-text">Manage Reservation</h1>
        <a
          href="https://tee24.golf"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary text-apple-xs"
        >
          Visit Tee24.Golf
        </a>
      </div>
      <p className="text-apple-sm text-apple-text-secondary mb-8">
        To change your reservation, cancel the current one and make a new reservation.
      </p>

      <div className="card mb-6 p-6">
        <h2 className="text-apple-lg font-semibold text-apple-text mb-4">Reservation Summary</h2>

        {bookingLoading ? (
          <p className="text-apple-sm text-apple-text-tertiary">Loading reservation…</p>
        ) : bookingLoadError ? (
          <p className="text-apple-sm text-apple-red">{bookingLoadError}</p>
        ) : booking ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 text-apple-sm">
            <div className="flex flex-col">
              <dt className="text-apple-text-tertiary text-apple-xs font-medium">Date</dt>
              <dd className="font-medium text-apple-text">{dateStr}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-apple-text-tertiary text-apple-xs font-medium">Time</dt>
              <dd className="font-medium text-apple-text">{timeStr}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-apple-text-tertiary text-apple-xs font-medium">Location</dt>
              <dd className="font-medium text-apple-text">{locationName || "—"}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-apple-text-tertiary text-apple-xs font-medium">Bay</dt>
              <dd className="font-medium text-apple-text">{bay}</dd>
            </div>
            {(guestName || guestContact) && (
              <>
                <div className="flex flex-col">
                  <dt className="text-apple-text-tertiary text-apple-xs font-medium">Guest</dt>
                  <dd className="font-medium text-apple-text">{guestName || "—"}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-apple-text-tertiary text-apple-xs font-medium">Contact</dt>
                  <dd className="font-medium text-apple-text">{guestContact || "—"}</dd>
                </div>
              </>
            )}
            <div className="flex flex-col">
              <dt className="text-apple-text-tertiary text-apple-xs font-medium">Booking ID</dt>
              <dd className="font-mono text-apple-xs text-apple-text-secondary">{booking?.id ?? "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-apple-sm text-apple-text-tertiary">No reservation found.</p>
        )}
      </div>

      {error && (
        <div className="mb-5 rounded-apple-sm border border-apple-red/30 bg-apple-red/5 p-3 text-apple-sm text-apple-red">
          {error}
        </div>
      )}

      <div className="card p-6">
        <div className="flex flex-col gap-4">
          <button
            onClick={cancelReservation}
            disabled={loading || !bookingId || !token}
            className="btn-danger w-full !py-3"
          >
            {loading ? "Canceling…" : "Cancel Current Reservation (and Re-Book)"}
          </button>
          {!token && (
            <p className="text-apple-xs text-apple-orange">
              This link is missing a token. Use the link from your confirmation to cancel.
            </p>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative z-10 w-full max-w-md rounded-apple bg-white p-6 shadow-apple-lg">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-apple-green/10">
              <svg className="h-5 w-5 text-apple-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-apple-xl font-semibold text-apple-text">Reservation Cancelled</h2>
            <p className="mt-2 text-apple-sm text-apple-text-secondary">
              Your reservation has been cancelled successfully. What would you like to do next?
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href="https://tee24.golf"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary w-full text-center"
              >
                Visit Tee24.Golf
              </a>
              <button onClick={gotoNewReservation} className="btn-primary w-full">
                New Reservation
              </button>
            </div>

            <button
              onClick={() => setShowModal(false)}
              className="mt-4 w-full rounded-apple-sm px-3 py-2 text-apple-sm text-apple-text-tertiary hover:bg-apple-fill-secondary transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
