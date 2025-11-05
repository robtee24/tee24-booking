// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // If you had redirects here before, remove the '/' -> '/app' rule.
  // Keep this redirects array if you have other rules, otherwise you can delete the whole 'redirects' block.
  async redirects() {
    return [
      // example of keeping other redirects:
      // { source: '/old', destination: '/new', permanent: true },
    ];
  },
};

export default nextConfig;