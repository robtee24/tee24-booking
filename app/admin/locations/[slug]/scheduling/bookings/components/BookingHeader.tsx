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
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={disabled}
          className={cn(
            "rounded-apple-sm border border-apple-border p-2 transition-all duration-200",
            disabled
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-apple-fill-secondary"
          )}
          aria-label="Previous day"
        >
          <ChevronLeft className="h-5 w-5 text-apple-text-secondary" />
        </button>

        <div className="card min-w-[260px] px-5 py-3 text-center text-apple-base font-medium text-apple-text">
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
            "rounded-apple-sm border border-apple-border p-2 transition-all duration-200",
            disabled
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-apple-fill-secondary"
          )}
          aria-label="Next day"
        >
          <ChevronRight className="h-5 w-5 text-apple-text-secondary" />
        </button>

        <button
          onClick={onToday}
          disabled={disabled}
          className={cn(
            "btn-secondary !rounded-apple-sm",
            disabled && "cursor-not-allowed opacity-50"
          )}
        >
          Today
        </button>
      </div>

      <button
        onClick={onAddBooking}
        disabled={disabled}
        className={cn(
          "btn-primary",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <Plus className="h-4 w-4 mr-1.5" />
        Add Booking
      </button>
    </div>
  );
}
