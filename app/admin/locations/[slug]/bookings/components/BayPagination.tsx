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
  currentPage: number; // 0-based
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

  // Generate visible page numbers (1-based display) with ellipsis
  const getPageNumbers = (): (number | "…")[] => {
    const delta = 2;
    const pages: (number | "…")[] = [];

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
      return pages;
    }

    // Always show page 1
    pages.push(1);

    if (currentPage < delta + 2) {
      // Near start: 1 2 3 4 5 ... 20
      for (let i = 2; i <= 5; i++) pages.push(i);
      pages.push("…", totalPages);
    } else if (currentPage >= totalPages - delta - 2) {
      // Near end: 1 ... 16 17 18 19 20
      pages.push("…");
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      // Middle: 1 ... 8 9 10 11 12 ... 20
      pages.push("…");
      for (let i = currentPage - delta; i <= currentPage + delta; i++) {
        pages.push(i + 1); // +1 because currentPage is 0-based
      }
      pages.push("…", totalPages);
    }

    return pages;
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
      <nav className="flex items-center gap-1" role="navigation" aria-label="Bay pagination">
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
        {pageNumbers.map((page, index) => {
          if (page === "…") {
            return (
              <span
                key={`ellipsis-${index}`}
                className="px-3 py-2 text-gray-500 select-none"
                aria-hidden="true"
              >
                …
              </span>
            );
          }

          return (
            <button
              key={page}
              onClick={() => onPageChange(page - 1)}
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
          );
        })}

        {/* Next */}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages - 1}
          className={cn(
            "p-2 rounded-lg border transition-all",
            currentPage >= totalPages - 1
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
          disabled={currentPage >= totalPages - 1}
          className={cn(
            "p-2 rounded-lg border transition-all",
            currentPage >= totalPages - 1
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