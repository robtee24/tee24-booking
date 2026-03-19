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
  getMemberStatus?: (email?: string, phone?: string) => string | null;
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
  getMemberStatus,
}: BayColumnProps) {
  const { getBookingPosition } = useBookingPosition({
    date,
    timezone: locationTimezone,
    pxPerMin,
  });

  const isDisabled = bay.disabled;

  return (
    <div
      ref={(el) => {
        if (el) bayRefs.current[bay.id] = el;
      }}
      className={`
        relative border-l transition-all duration-200
        ${isDisabled
          ? "bg-apple-fill-secondary border-apple-border"
          : "bg-white border-apple-divider"
        }
      `}
      style={{ height: totalHeight }}
      onDragOver={onBayDragOver}
      onDrop={(e) => {
        if (isDisabled) {
          e.preventDefault();
          return;
        }
        onBayDrop(e, bay);
      }}
    >
      {isDisabled && (
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage: `repeating-linear-gradient(
              45deg,
              transparent,
              transparent 8px,
              #D2D2D7 8px,
              #D2D2D7 16px
            )`,
          }}
        />
      )}

      <GridLines
        timeStep={timeStep}
        pxPerMin={pxPerMin}
        totalHeight={totalHeight}
        className={isDisabled ? "opacity-30" : ""}
      />

      <div className={isDisabled ? "opacity-40" : ""}>
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
              locationTimezone={locationTimezone}
              onDragStart={onBookingDragStart}
              onClick={() => onBookingClick(booking, bay)}
              onDelete={() => onDeleteBooking(booking.id)}
              memberStatus={getMemberStatus?.(booking.email, booking.phone) ?? null}
            />
          );
        })}
      </div>
    </div>
  );
}
