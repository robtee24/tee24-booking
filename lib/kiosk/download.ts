/**
 * Where admins download the Tee24 Bay Kiosk installer.
 *
 * Set NEXT_PUBLIC_BAY_KIOSK_DOWNLOAD_URL in Vercel to a direct installer URL
 * (e.g. a GitHub release asset). Falls back to the repo's latest-release page,
 * which always resolves (no dead links in the admin).
 */
export const KIOSK_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_BAY_KIOSK_DOWNLOAD_URL?.trim() ||
  "https://github.com/robtee24/tee24-booking/releases/latest";

export const KIOSK_APP_NAME = "Tee24 Bay Kiosk";
