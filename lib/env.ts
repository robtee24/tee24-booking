// lib/env.ts
function req(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.warn(`[env] Missing ${name} — check your .env.local`);
    return "";
  }
  return v;
}

function reqNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) {
    console.warn(`[env] Missing ${name} — using fallback: ${fallback}`);
    return fallback;
  }
  const num = Number(v);
  if (isNaN(num)) {
    console.warn(`[env] ${name} is not a valid number: ${v} — using fallback: ${fallback}`);
    return fallback;
  }
  return num;
}

export const ENV = {
  AUTH_SECRET: req("AUTH_SECRET"),
  // OpenPhone
  OPENPHONE_API_KEY: req("OPENPHONE_API_KEY"),
  OPENPHONE_NUMBER: req("OPENPHONE_NUMBER"),
  // App
  APP_BASE_URL: process.env.APP_BASE_URL || "http://localhost:3000",
  // OTP
  OTP_TTL: Number(process.env.OTP_TTL_SECONDS || 300),
  ROOT_ADMIN_PHONE: process.env.ROOT_ADMIN_PHONE || "",
  // Session
  SESSION_MAX_AGE: reqNum("SESSION_MAX_AGE", 60 * 60 * 24 * 7), // 7 days default
};

export default ENV;