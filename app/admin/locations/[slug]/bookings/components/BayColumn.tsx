// app/admin/locations/[slug]/bookings/components/BayColumn.tsx
"use client";

import type { Bay } from "@/types/bay";
import type { AdminBooking } from "@/types/admin-booking";

import { BookingBlock } from "./BookingBlock";
import { GridLines } from "./GridLines";
import { useBookingPosition } from "../hooks/useBookingPosition";

type BayColumnProps = {
  bay: Bay;
  bookings: AdminBooking[];
  date: Date;
  locationTimezone: string;
  pxPerMin: number;
  totalHeight: number;
  timeStep: number;
  palette: string[][];
  bayRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  onBookingDragStart: (e: React.DragEvent, bk: AdminBooking) => void;
  onBayDragOver: (e: React.DragEvent) => void;
  onBayDrop: (e: React.DragEvent, bay: Bay) => void;
  onBookingClick: (booking: AdminBooking, bay: Bay) => void;
  onDeleteBooking: (id: string) => void;
};

export function BayColumn({
  bay,
  bookings,
  date,
  locationTimezone,
  pxPerMin,
  totalHeight,
  timeStep,
  palette,
  bayRefs,
  onBookingDragStart,
  onBayDragOver,
  onBayDrop,
  onBookingClick,
  onDeleteBooking,
}: BayColumnProps) {

  console.log('locationTimezone', locationTimezone);
  const { getBookingPosition } = useBookingPosition({
    date,
    timezone: locationTimezone,
    pxPerMin,
  });

  return (
    <div
      ref={(el) => {
        if (el) bayRefs.current[bay.id] = el;
      }}
      className="relative border-l bg-white"
      style={{ height: totalHeight }}
      onDragOver={onBayDragOver}
      onDrop={(e) => onBayDrop(e, bay)}
    >
      {/* Horizontal grid lines */}
      <GridLines
        timeStep={timeStep}
        pxPerMin={pxPerMin}
        totalHeight={totalHeight}
      />

      {/* Bookings */}
      {bookings.map((booking, idx) => {
        const position = getBookingPosition(booking);

        if (!position) return null;

        const { top, height } = position;

        return (
          <BookingBlock
            key={booking.id}
            booking={booking}
            bay={bay}
            top={top}
            height={height}
            palette={palette[idx % palette.length]}
            onDragStart={onBookingDragStart}
            onClick={() => onBookingClick(booking, bay)}
            onDelete={() => onDeleteBooking(booking.id)}
          />
        );
      })}
    </div>
  );
}