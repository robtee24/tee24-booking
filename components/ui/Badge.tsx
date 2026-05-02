import React from "react";

type Tone = "default" | "success" | "warn" | "danger" | "info" | "muted";
type Size = "sm" | "md";

type BadgeProps = {
  tone?: Tone;
  size?: Size;
  children: React.ReactNode;
  className?: string;
};

const TONES: Record<Tone, string> = {
  default: "bg-apple-fill-secondary text-apple-text border border-apple-border",
  success: "bg-apple-green/10 text-apple-green border border-apple-green/20",
  warn:    "bg-apple-orange/10 text-apple-orange border border-apple-orange/20",
  danger:  "bg-apple-red/10 text-apple-red border border-apple-red/20",
  info:    "bg-apple-blue/10 text-apple-blue border border-apple-blue/20",
  muted:   "bg-apple-fill-secondary text-apple-text-secondary border border-apple-border",
};

const SIZES: Record<Size, string> = {
  sm: "text-[10px] leading-4 px-1.5 py-0.5",
  md: "text-apple-xs leading-5 px-2 py-0.5",
};

export function Badge({ tone = "default", size = "md", children, className = "" }: BadgeProps) {
  return (
    <span className={["inline-flex items-center gap-1 rounded-full font-medium", TONES[tone], SIZES[size], className].join(" ")}>
      {children}
    </span>
  );
}

const STATUS_TO_TONE: Record<string, Tone> = {
  ACTIVE: "success",
  PAID: "success",
  SUCCEEDED: "success",
  DELIVERED: "success",
  COMPLETED: "success",
  PENDING: "warn",
  SCHEDULED: "info",
  PAST_DUE: "warn",
  FROZEN: "info",
  CANCEL_SCHEDULED: "warn",
  CANCELLED: "muted",
  EXPIRED: "danger",
  FAILED: "danger",
  REFUNDED: "muted",
  CHARGEBACK: "danger",
  PARTIALLY_REFUNDED: "warn",
  DISPUTED: "danger",
  COMP: "info",
  VISITOR: "info",
  OPEN: "info",
  RESOLVED: "muted",
  AT_RISK: "danger",
  INACTIVE: "muted",
  LIGHT: "warn",
  AVERAGE: "default",
  ABOVE_AVG: "success",
};

export function StatusBadge({ status, size = "md", className = "" }: { status: string; size?: Size; className?: string }) {
  const tone = STATUS_TO_TONE[status] ?? "default";
  return (
    <Badge tone={tone} size={size} className={className}>
      {status.replaceAll("_", " ")}
    </Badge>
  );
}
