/**
 * PWA manifest for the member portal.
 * Served at /portal/manifest.webmanifest by Next.js.
 */
import { type MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tee24 Member Portal",
    short_name: "Tee24",
    description: "Manage your membership, bookings, and access.",
    start_url: "/portal",
    scope: "/portal",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#16a34a",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
