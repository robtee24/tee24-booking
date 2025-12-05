// app/admin/locations/[slug]/bookings/components/BayPagination.tsx
"use client";

import React from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type BayPaginationProps = {
  currentPage: number;        // 0-based
  totalPages: number;
  totalBays: number;
  baysPerPage: number;
  onPageChange: (page: number) => void;
};

export function BayPagination({
  currentPage,
  totalPages,
  totalBays,
  baysPerPage,
  onPageChange,
}: BayPaginationProps) {
  const startBay = currentPage * baysPerPage + 1;
  const endBay = Math.min((currentPage + 1) * baysPerPage, totalBays);

  // Generate page numbers with smart ellipsis
  const getPageNumbers = () => {
    const delta = 2;
    const range: (number | string)[] = [];
    const rangeWithDots: (number | string)[] = [];

    range.push(1);

    if (totalPages <= 7) {
      for (let i = 2; i <= totalPages; i++) range.push(i);
    } else {
      if (currentPage <= delta + 1) {
        for (let i = 2; i <= delta + 3; i++) range.push(i);
        rangeWithDots.push(...range, "…", totalPages);
      } else if (currentPage >= totalPages - delta - 1) {
        rangeWithDots.push(1, "…");
        for (let i = totalPages - delta - 2; i <= totalPages; i++) rangeWithDots.push(i);
      } else {
        rangeWithDots.push(1, "…");
        for (let i = currentPage - delta; i <= currentPage + delta; i++) rangeWithDots.push(i);
        rangeWithDots.push("…", totalPages);
      }
      return rangeWithDots;
    }

    return range;
  };

  const pageNumbers = getPageNumbers();

  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4 border-t bg-white px-1">
      {/* Range info */}
      <div className="text-sm text-gray-700 whitespace-nowrap">
        Bays <span className="font-medium">{startBay}–{endBay}</span> of{" "}
        <span className="font-medium">{totalBays}</span>
      </div>

      {/* Pagination controls */}
      <nav
        className="flex items-center gap-1"
        role="navigation"
        aria-label="Bay pagination"
      >
        {/* First */}
        <button
          onClick={() => onPageChange(0)}
          disabled={currentPage === 0}
          className={cn(
            "p-2 rounded-lg border transition-all",
            currentPage === 0
              ? "text-gray-400 border-gray-200 cursor-not-allowed"
              : "text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400"
          )}
          aria-label="First page"
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>

        {/* Previous */}
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 0}
          className={cn(
            "p-2 rounded-lg border transition-all",
            currentPage === 0
              ? "text-gray-400 border-gray-200 cursor-not-allowed"
              : "text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400"
          )}
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Page numbers */}
        {pageNumbers.map((page, i) =>
          page === "…" ? (
            <span
              key={`dots-${i}`}
              className="px-3 py-2 text-gray-500 select-none"
              aria-hidden="true"
            >
              …
            </span>
          ) : (
            <button
              key={page}
              onClick={() => onPageChange(page - 1)} // convert to 0-based
              className={cn(
                "min-w-10 px-3 py-2 rounded-lg border text-sm font-medium transition-all",
                currentPage === page - 1
                  ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                  : "text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400"
              )}
              aria-label={`Page ${page}`}
              aria-current={currentPage === page - 1 ? "page" : undefined}
            >
              {page}
            </button>
          )
        )}

        {/* Next */}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages - 1}
          className={cn(
            "p-2 rounded-lg border transition-all",
            currentPage === totalPages - 1
              ? "text-gray-400 border-gray-200 cursor-not-allowed"
              : "text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400"
          )}
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        {/* Last */}
        <button
          onClick={() => onPageChange(totalPages - 1)}
          disabled={currentPage === totalPages - 1}
          className={cn(
            "p-2 rounded-lg border transition-all",
            currentPage === totalPages - 1
              ? "text-gray-400 border-gray-200 cursor-not-allowed"
              : "text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400"
          )}
          aria-label="Last page"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </nav>
    </div>
  );
}