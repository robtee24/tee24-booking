"use client";

import React from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "link";
type Size = "sm" | "md" | "lg";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-apple-xs",
  md: "h-10 px-5 text-apple-sm",
  lg: "h-12 px-6 text-apple-base",
};

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-apple-blue text-white hover:bg-apple-blue-hover disabled:bg-apple-text-tertiary",
  secondary:
    "border border-apple-border bg-white text-apple-text hover:bg-apple-fill-secondary disabled:opacity-40",
  danger:
    "border border-apple-red/30 bg-apple-red/5 text-apple-red hover:bg-apple-red/10 disabled:opacity-40",
  ghost:
    "text-apple-text hover:bg-apple-fill-secondary disabled:opacity-40",
  link:
    "text-apple-blue hover:underline underline-offset-2 disabled:opacity-40",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, disabled, iconLeft, iconRight, children, className = "", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-apple-pill font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/30",
        "disabled:cursor-not-allowed",
        SIZES[size],
        VARIANTS[variant],
        className,
      ].join(" ")}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  );
});
