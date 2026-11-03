// next.config.ts
import type { NextConfig } from "next";

// Baseline browser hardening. Vercel already sends HSTS; the rest is on us.
// The /signup/* pages are intentionally embeddable (franchise sites drop the
// snippet from lib/signup-form-config.ts into an <iframe>), so they are the one
// surface left without a frame-ancestors restriction.
const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const noFrameHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: baseHeaders },
      // Admin UI + every API route: never framable.
      { source: "/admin/:path*", headers: noFrameHeaders },
      { source: "/api/:path*", headers: noFrameHeaders },
      // Everything else except the embeddable signup forms: same-origin only.
      {
        source: "/((?!admin|api|signup).*)",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }],
      },
    ];
  },
  async redirects() {
    return [];
  },
};

export default nextConfig;
