// app/admin/locations/[slug]/bookings/components/BookingHeader.tsx
"use client";

import React from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

type BookingHeaderProps = {
  date: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onAddBooking: () => void;
};

export function BookingHeader({
  date,
  onPrev,
  onNext,
  onToday,
  onAddBooking,
}: BookingHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      {/* Date Navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          className="rounded-xl border p-2 hover:bg-gray-50 transition"
          aria-label="Previous day"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="min-w-[260px] rounded-xl border bg-white px-5 py-3 text-center font-medium shadow-sm">
          {date.toLocaleDateString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </div>

        <button
          onClick={onNext}
          className="rounded-xl border p-2 hover:bg-gray-50 transition"
          aria-label="Next day"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        <button
          onClick={onToday}
          className="rounded-xl border px-4 py-2.5 text-sm font-medium hover:bg-gray-50 transition"
        >
          Today
        </button>
      </div>

      {/* Add Booking Button */}
      <button
        onClick={onAddBooking}
        className="inline-flex items-center gap-2 rounded-xl border bg-white px-5 py-2.5 font-medium hover:bg-gray-50 transition shadow-sm"
      >
        <Plus className="h-4 w-4" />
        Add Booking
      </button>
    </div>
  );
}