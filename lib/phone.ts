// lib/phone.ts  ← THIS IS NOW CANONICAL

export function toE164(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");

  // Order matters — most common cases first
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;

  throw new Error("Invalid phone number");
}