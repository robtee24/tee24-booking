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
  currentPage: number;
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

  const getPageNumbers = (): (number | "…")[] => {
    const delta = 2;
    const pages: (number | "…")[] = [];

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }

    pages.push(1);

    if (currentPage < delta + 2) {
      for (let i = 2; i <= 5; i++) pages.push(i);
      pages.push("…", totalPages);
    } else if (currentPage >= totalPages - delta - 2) {
      pages.push("…");
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push("…");
      for (let i = currentPage - delta; i <= currentPage + delta; i++) {
        pages.push(i + 1);
      }
      pages.push("…", totalPages);
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();

  if (totalPages <= 1) return null;

  const navBtnClass = (disabled: boolean) =>
    cn(
      "p-2 rounded-apple-sm border transition-all duration-200",
      disabled
        ? "text-apple-text-tertiary border-apple-divider cursor-not-allowed"
        : "text-apple-text-secondary border-apple-border hover:bg-apple-fill-secondary hover:border-apple-text-tertiary"
    );

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4 border-t border-apple-divider bg-white px-1">
      <div className="text-apple-sm text-apple-text-secondary whitespace-nowrap">
        Bays <span className="font-medium text-apple-text">{startBay}–{endBay}</span> of{" "}
        <span className="font-medium text-apple-text">{totalBays}</span>
      </div>

      <nav className="flex items-center gap-1" role="navigation" aria-label="Bay pagination">
        <button onClick={() => onPageChange(0)} disabled={currentPage === 0} className={navBtnClass(currentPage === 0)} aria-label="First page">
          <ChevronsLeft className="w-4 h-4" />
        </button>

        <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 0} className={navBtnClass(currentPage === 0)} aria-label="Previous page">
          <ChevronLeft className="w-4 h-4" />
        </button>

        {pageNumbers.map((page, index) => {
          if (page === "…") {
            return (
              <span key={`ellipsis-${index}`} className="px-3 py-2 text-apple-text-tertiary select-none" aria-hidden="true">
                …
              </span>
            );
          }

          return (
            <button
              key={page}
              onClick={() => onPageChange(page - 1)}
              className={cn(
                "min-w-10 px-3 py-2 rounded-apple-sm border text-apple-sm font-medium transition-all duration-200",
                currentPage === page - 1
                  ? "bg-apple-blue text-white border-apple-blue shadow-apple"
                  : "text-apple-text-secondary border-apple-border hover:bg-apple-fill-secondary hover:border-apple-text-tertiary"
              )}
              aria-label={`Page ${page}`}
              aria-current={currentPage === page - 1 ? "page" : undefined}
            >
              {page}
            </button>
          );
        })}

        <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= totalPages - 1} className={navBtnClass(currentPage >= totalPages - 1)} aria-label="Next page">
          <ChevronRight className="w-4 h-4" />
        </button>

        <button onClick={() => onPageChange(totalPages - 1)} disabled={currentPage >= totalPages - 1} className={navBtnClass(currentPage >= totalPages - 1)} aria-label="Last page">
          <ChevronsRight className="w-4 h-4" />
        </button>
      </nav>
    </div>
  );
}
