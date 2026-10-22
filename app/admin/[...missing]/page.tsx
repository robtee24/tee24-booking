import { notFound } from "next/navigation";

/**
 * Catch-all for unknown /admin/* URLs. Routes the request to app/admin/not-found.tsx
 * so a bad link renders the in-shell 404 instead of the bare framework page.
 */
export default function AdminCatchAll() {
  notFound();
}
