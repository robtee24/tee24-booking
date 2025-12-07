// types/otp.ts

export type OtpPurpose =
  | "admin_login"
  | "customer_booking"
  | "customer_signup"
  | "password_reset";

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; reason: "EXPIRED" | "MISMATCH" | "NOT_FOUND" | "INVALID_FORMAT" };