// components/ui/Modal.tsx
"use client";

import React from "react";
import { X } from "lucide-react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  /** Wider dialog on desktop */
  wide?: boolean;
  hideCloseButton?: boolean;
  /** Sticky footer (actions). Rendered outside the scroll area. */
  footer?: React.ReactNode;
};

/**
 * Accessible modal dialog.
 * - Desktop: centered card.
 * - Mobile (< sm): full-height bottom sheet so forms are usable with the keyboard open.
 * - Escape closes, backdrop click closes, body scroll is locked while open.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  hideCloseButton = false,
  footer,
}: ModalProps) {
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className={[
          "relative z-10 flex w-full flex-col bg-white shadow-apple-lg",
          "max-h-[92dvh] rounded-t-apple sm:mx-4 sm:max-h-[90vh] sm:rounded-apple",
          wide ? "sm:max-w-2xl" : "sm:max-w-xl",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
      >
        {/* Drag handle (mobile affordance) */}
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-apple-border sm:hidden" aria-hidden />

        {(title || !hideCloseButton) && (
          <div className="flex items-start justify-between gap-4 border-b border-apple-divider px-5 py-4 sm:px-6">
            <div className="min-w-0">
              {title && (
                <h3 id={titleId} className="text-apple-lg font-semibold text-apple-text sm:text-apple-xl">
                  {title}
                </h3>
              )}
              {description && <p className="mt-0.5 text-apple-sm text-apple-text-secondary">{description}</p>}
            </div>
            {!hideCloseButton && (
              <button
                onClick={onClose}
                className="-mr-2 shrink-0 rounded-apple-sm p-2 text-apple-text-tertiary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/30"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>

        {footer && (
          <div className="border-t border-apple-divider bg-apple-fill-secondary px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
