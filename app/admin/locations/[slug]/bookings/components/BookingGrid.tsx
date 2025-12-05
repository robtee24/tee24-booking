// app/admin/locations/[slug]/bookings/components/BookingGrid.tsx
"use client";

import { TimeGutter } from "./TimeGutter";
import { BayColumn } from "./BayColumn";

import type { Bay } from "@/types/bay";
import type { AdminBooking } from "@/types/admin-booking";

type BookingGridProps = {
  visibleBays: Bay[];
  bookings: AdminBooking[] | undefined;   // ← allow undefined during loading
  locationTimezone: string;
  date: Date;
  timeStep: number;
  pxPerMin: number;
  totalHeight: number;
  palette: string[][];
  bayRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  onBookingDragStart: (e: React.DragEvent, bk: AdminBooking) => void;
  onBayDragOver: (e: React.DragEvent) => void;
  onBayDrop: (e: React.DragEvent, bay: Bay) => void;
  onBookingClick: (booking: AdminBooking, bay: Bay) => void;
  onDeleteBooking: (id: string) => void;
};

export function BookingGrid({
  visibleBays,
  bookings = [],
  locationTimezone,
  date,
  timeStep,
  pxPerMin,
  totalHeight,
  palette,
  bayRefs,
  onBookingDragStart,
  onBayDragOver,
  onBayDrop,
  onBookingClick,
  onDeleteBooking,
}: BookingGridProps) {
  // Nothing to render
  if (visibleBays.length === 0) return null;

  const bookingsByBay = visibleBays.map((bay) => ({
    bay,
    bookings: bookings
      .filter((b) => b.bayNumber === bay.number)
      .sort((a, b) => a.start.localeCompare(b.start)),
  }));

  const columnTemplate = `80px repeat(${visibleBays.length}, 1fr)`;

  return (
    <>
      {/* Sticky Header */}
      <div className="sticky top-0 z-20 border-b bg-white shadow-sm">
        <div
          className="grid text-sm font-medium"
          style={{ gridTemplateColumns: columnTemplate }}
        >
          <div className="px-3 py-2 text-right text-gray-500">Time</div>
          {visibleBays.map((bay) => (
            <div key={bay.id} className="px-3 py-2 truncate">
              Bay {bay.number}
              {bay.name && <span className="ml-1 text-gray-500">({bay.name})</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Main Grid */}
      <div
        className="grid overflow-auto border-t bg-gray-50/50"
        style={{ gridTemplateColumns: columnTemplate }}
      >
        <TimeGutter pxPerMin={pxPerMin} totalHeight={totalHeight} />

        {bookingsByBay.map(({ bay, bookings: bayBookings }) => (
          <BayColumn
            key={bay.id}
            bay={bay}
            bookings={bayBookings}
            date={date}
            locationTimezone={locationTimezone}
            pxPerMin={pxPerMin}
            totalHeight={totalHeight}
            timeStep={timeStep}
            palette={palette}
            bayRefs={bayRefs}
            onBookingDragStart={onBookingDragStart}
            onBayDragOver={onBayDragOver}
            onBayDrop={onBayDrop}
            onBookingClick={onBookingClick}
            onDeleteBooking={onDeleteBooking}
          />
        ))}
      </div>
    </>
  );
}