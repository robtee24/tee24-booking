/**
 * PWA manifest for the member portal.
 * Served at /portal/manifest.webmanifest by Next.js.
 */
import { type MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tee24 Clubhouse",
    short_name: "Tee24",
    description: "Book bays, unlock the door and manage your Tee24 membership.",
    start_url: "/portal",
    scope: "/portal",
    display: "standalone",
    background_color: "#0b0f0b",
    theme_color: "#0b3d2e",
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
