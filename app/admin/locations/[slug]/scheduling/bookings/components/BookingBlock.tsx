// app/admin/locations/[slug]/bookings/components/BookingBlock.tsx
"use client";

import type { AdminBooking } from "@/types/admin-booking";
import type { Bay } from "@/types/bay";
import { DeleteButton } from "./DeleteButton";
import { formatTimeRange } from "@/lib/time-utils";

const MEMBER_BADGE: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'M', cls: 'bg-emerald-500 text-white' },
  VISITOR: { label: 'V', cls: 'bg-blue-500 text-white' },
  CANCELLED: { label: 'C', cls: 'bg-red-400 text-white' },
  FROZEN: { label: 'F', cls: 'bg-amber-400 text-white' },
};

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
  memberStatus: string | null;
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
  memberStatus,
}: BookingBlockProps) {
  const [bg, br, tx] = palette;

  const timeLabel = formatTimeRange(bk.start, bk.end, locationTimezone);
  const badge = memberStatus ? MEMBER_BADGE[memberStatus] : null;

  return (
    <div
      className={`absolute left-1 right-1 rounded-apple-sm border shadow-apple px-2 py-1 cursor-grab active:cursor-grabbing group ${bg} ${br} ${tx} transition-all duration-200 hover:shadow-apple-md hover:z-10`}
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
        <div className="flex items-center gap-1 text-[11px] leading-none font-medium truncate">
          {badge && (
            <span className={`inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-bold leading-none ${badge.cls}`} title={memberStatus!}>
              {badge.label}
            </span>
          )}
          <span className="truncate">{bk.firstName} {bk.lastName} — {timeLabel}</span>
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
