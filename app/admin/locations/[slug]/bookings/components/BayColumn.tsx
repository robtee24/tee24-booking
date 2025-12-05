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
        relative border-l transition-all duration-300
        ${isDisabled 
          ? "bg-gray-100 border-gray-300" 
          : "bg-white border-gray-200"
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
      {/* Subtle diagonal stripes only when disabled */}
      {isDisabled && (
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage: `repeating-linear-gradient(
              45deg,
              transparent,
              transparent 8px,
              #9ca3af 8px,
              #9ca3af 16px
            )`,
          }}
        />
      )}

      {/* Grid lines — faded when disabled */}
      <GridLines
        timeStep={timeStep}
        pxPerMin={pxPerMin}
        totalHeight={totalHeight}
        className={isDisabled ? "opacity-30" : ""}
      />

      {/* Bookings — dimmed when bay is disabled */}
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
              onDragStart={onBookingDragStart}
              onClick={() => onBookingClick(booking, bay)}
              onDelete={() => onDeleteBooking(booking.id)}
            />
          );
        })}
      </div>      
    </div>
  );
}