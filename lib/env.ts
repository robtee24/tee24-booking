// lib/env.ts

function req(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.warn(`[env] Missing ${name} — check your .env.local`);
    return "";
  }
  return v;
}

export const ENV = {
  AUTH_SECRET: req("AUTH_SECRET"),

  // OpenPhone
  OPENPHONE_API_KEY: req("OPENPHONE_API_KEY"),
  OPENPHONE_NUMBER: req("OPENPHONE_NUMBER"), // e.g. +15025551234

  // App
  APP_BASE_URL: process.env.APP_BASE_URL || "http://localhost:3000",

  // OTP
  OTP_TTL: Number(process.env.OTP_TTL_SECONDS || 300),

  // Admin allow-list
  ALLOWED_PHONES: (process.env.ALLOWED_ADMIN_PHONES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  ROOT_ADMIN_PHONE: process.env.ROOT_ADMIN_PHONE || "",
};

export default ENV;
