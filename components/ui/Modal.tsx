// components/ui/Modal.tsx
"use client";

import React from "react";
import { X } from "lucide-react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  wide?: boolean;
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
        className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        className={`relative z-10 w-full ${
          wide ? "max-w-2xl" : "max-w-xl"
        } mx-4 max-h-[90vh] overflow-y-auto rounded-apple bg-white shadow-apple-lg`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "modal-title" : undefined}
      >
        {/* Header */}
        {(title || !hideCloseButton) && (
          <div className="flex items-center justify-between border-b border-apple-divider px-6 py-4">
            {title && (
              <h3 id="modal-title" className="text-apple-xl font-semibold text-apple-text">
                {title}
              </h3>
            )}
            {!hideCloseButton && (
              <button
                onClick={onClose}
                className="rounded-apple-sm p-2 text-apple-text-tertiary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
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
