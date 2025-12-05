// app/admin/locations/[slug]/bookings/components/BookingHeader.tsx
"use client";
import React from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type BookingHeaderProps = {
  date: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onAddBooking: () => void;
  disabled?: boolean;
};

export function BookingHeader({
  date,
  onPrev,
  onNext,
  onToday,
  onAddBooking,
  disabled = false,
}: BookingHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      {/* Date Navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={disabled}
          className={cn(
            "rounded-xl border p-2 transition",
            disabled
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-gray-50"
          )}
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
          disabled={disabled}
          className={cn(
            "rounded-xl border p-2 transition",
            disabled
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-gray-50"
          )}
          aria-label="Next day"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        <button
          onClick={onToday}
          disabled={disabled}
          className={cn(
            "rounded-xl border px-4 py-2.5 text-sm font-medium transition",
            disabled
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-gray-50"
          )}
        >
          Today
        </button>
      </div>

      {/* Add Booking Button */}
      <button
        onClick={onAddBooking}
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border bg-white px-5 py-2.5 font-medium shadow-sm transition",
          disabled
            ? "cursor-not-allowed opacity-50"
            : "hover:bg-gray-50"
        )}
      >
        <Plus className="h-4 w-4" />
        Add Booking
      </button>
    </div>
  );
}