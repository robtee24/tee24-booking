// app/components/ui/Modal.tsx
"use client";

import React from "react";
import { X } from "lucide-react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  wide?: boolean;        // max-w-2xl instead of max-w-xl
  hideCloseButton?: boolean;
};

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
  hideCloseButton = false,
}: ModalProps) {
  if (!open) return null;

  // Allow closing with Escape key
  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        className={`relative z-10 w-full ${
          wide ? "max-w-2xl" : "max-w-xl"
        } mx-4 max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-black/5`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "modal-title" : undefined}
      >
        {/* Header */}
        {(title || !hideCloseButton) && (
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            {title && (
              <h3 id="modal-title" className="text-xl font-semibold text-gray-900">
                {title}
              </h3>
            )}
            {!hideCloseButton && (
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
                aria-label="Close modal"
              >
                {/* You can replace with lucide-react X or keep the SVG */}
                <X className="h-5 w-5" />
                {/* If you don't have lucide-react, use this instead: */}
                {/* <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg> */}
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}