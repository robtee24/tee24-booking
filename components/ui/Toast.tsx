"use client";

import React from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type Toast = {
  id: string;
  tone: "success" | "error" | "info";
  title: string;
  description?: string;
  durationMs?: number;
};

type ToastContextType = {
  toast: (t: Omit<Toast, "id">) => void;
};

const ToastContext = React.createContext<ToastContextType | null>(null);

export function useToast(): ToastContextType {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const toast: ToastContextType["toast"] = React.useCallback((t) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newToast: Toast = { id, durationMs: 4000, ...t };
    setToasts((cur) => [...cur, newToast]);
    setTimeout(() => {
      setToasts((cur) => cur.filter((x) => x.id !== id));
    }, newToast.durationMs);
  }, []);

  function dismiss(id: string) {
    setToasts((cur) => cur.filter((x) => x.id !== id));
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            className={[
              "flex items-start gap-3 rounded-apple border bg-white p-3 shadow-apple-md",
              t.tone === "success" ? "border-apple-green/30" :
              t.tone === "error" ? "border-apple-red/30" : "border-apple-border",
            ].join(" ")}
          >
            <span className={[
              "mt-0.5 shrink-0",
              t.tone === "success" ? "text-apple-green" :
              t.tone === "error" ? "text-apple-red" : "text-apple-blue",
            ].join(" ")}>
              {t.tone === "success" ? <CheckCircle2 className="h-5 w-5" /> :
               t.tone === "error" ? <AlertCircle className="h-5 w-5" /> :
               <Info className="h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-apple-sm font-medium text-apple-text">{t.title}</p>
              {t.description && <p className="mt-0.5 text-apple-xs text-apple-text-secondary">{t.description}</p>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-apple-sm p-1 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-text"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
