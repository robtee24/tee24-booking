"use client";

import React from "react";
import { X } from "lucide-react";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  footer?: React.ReactNode;
};

const WIDTHS = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-2xl",
} as const;

/**
 * Right-side slide-over panel. Full-width on phones, fixed max width on desktop.
 * Escape / backdrop close; body scroll locked while open.
 */
export function Drawer({ open, onClose, title, description, children, width = "md", footer }: DrawerProps) {
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <aside className={`relative ml-auto flex h-full w-full ${WIDTHS[width]} flex-col bg-white shadow-apple-lg`}>
        {(title || description) && (
          <header className="flex items-start justify-between gap-4 border-b border-apple-divider px-5 py-4">
            <div className="min-w-0">
              {title && <h2 id={titleId} className="text-apple-lg font-semibold text-apple-text">{title}</h2>}
              {description && <p className="mt-0.5 text-apple-sm text-apple-text-secondary">{description}</p>}
            </div>
            <button
              onClick={onClose}
              className="-mr-2 shrink-0 rounded-apple-sm p-2 text-apple-text-tertiary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/30"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </header>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
        {footer && (
          <footer className="border-t border-apple-divider bg-apple-fill-secondary px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
}
