"use client";

import React from "react";
import { X } from "lucide-react";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  footer?: React.ReactNode;
};

const WIDTHS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
} as const;

export function Drawer({ open, onClose, title, children, width = "md", footer }: DrawerProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <aside className={`relative ml-auto h-full w-full ${WIDTHS[width]} flex flex-col bg-white shadow-apple-lg`}>
        {title && (
          <header className="flex items-center justify-between border-b border-apple-divider px-5 py-4">
            <h2 className="text-apple-lg font-semibold text-apple-text">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-apple-sm p-2 text-apple-text-tertiary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/30"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </header>
        )}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <footer className="border-t border-apple-divider bg-apple-fill-secondary px-5 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}
