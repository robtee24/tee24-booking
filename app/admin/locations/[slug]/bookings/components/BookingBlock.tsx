// app/admin/locations/[slug]/bookings/components/BookingBlock.tsx
"use client";

import type { AdminBooking } from "@/types/admin-booking";
import type { Bay } from "@/types/bay";
import { DeleteButton } from "./DeleteButton";
import { formatTimeRange } from "@/lib/time-utils";

type BookingBlockProps = {
  booking: AdminBooking;
  bay: Bay;
  top: number;
  height: number;
  palette: string[];
  locationTimezone: string;
  onDragStart: (e: React.DragEvent, booking: AdminBooking) => void;
  onClick: () => void;
  onDelete: () => void;
};

export function BookingBlock({
  booking: bk,
  bay,
  top,
  height,
  palette,
  locationTimezone,
  onDragStart,
  onClick,
  onDelete,
}: BookingBlockProps) {
  const [bg, br, tx] = palette;

  // Use the location timezone
  const timeLabel = formatTimeRange(bk.start, bk.end, locationTimezone);

  return (
    <div
      className={`absolute left-0 right-0 border-y shadow-sm px-2 py-1 cursor-grab active:cursor-grabbing group ${bg} ${br} ${tx} transition-all hover:z-10`}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        minHeight: Math.max(height, 28),
      }}
      draggable
      onDragStart={(e) => onDragStart(e, bk)}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] leading-none font-medium truncate">
          {bk.firstName} {bk.lastName} — {timeLabel}
        </div>

        <DeleteButton
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        />
      </div>
    </div>
  );
}