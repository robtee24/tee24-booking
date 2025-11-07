// lib/template-vars.ts
import { formatDate, formatTime } from "@/lib/template";

export type TemplateVars = Record<string, string | number | null | undefined>;

export interface BookingContext {
  bookingId: string;
  managementToken: string | null;
  startISO: string;
  endISO: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  bayNumber: number | null;
  locationName: string;
  locationSlug: string;
  manageUrl?: string;          // optional – we compute it if missing
  bookingNote?: string;
}

/**
 * Build the **exact** variable map that every renderer expects.
 * Call it once per send (confirmation or reminder) and you’re done.
 */
export function buildTemplateVars(ctx: BookingContext): TemplateVars {
  const startStr = formatTime(ctx.startISO);
  const endStr   = formatTime(ctx.endISO);

  const manage = ctx.manageUrl ??
    `${process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") || "http://localhost:3000"}/manage/${ctx.bookingId}?token=${encodeURIComponent(ctx.managementToken ?? "")}`;

  return {
    // Core guest data
    firstName:   ctx.firstName ?? "",
    lastName:    ctx.lastName  ?? "",
    email:       ctx.email     ?? "",
    phone:       ctx.phone     ?? "",

    // Location
    locationName: ctx.locationName,
    locationSlug: ctx.locationSlug,

    // Booking details
    date:        formatDate(ctx.startISO),
    start:       startStr,
    end:         endStr,
    startTime:   startStr,   // alias
    endTime:     endStr,     // alias
    bayNumber:   ctx.bayNumber ?? "—",
    manageUrl:   manage,
    bookingNote: ctx.bookingNote ?? "",

    // Future-proof – add new keys here, they’ll automatically appear everywhere
  };
}

/**
 * The list the admin UI shows in the “merge-field helper”.
 * Keep it in sync with `buildTemplateVars` (or import it).
 */
export const MERGE_FIELDS = {
  recommended: [
    "firstName",
    "lastName",
    "email",
    "phone",
    "locationName",
    "bayNumber",
    "date",
    "start",          // primary
    "end",            // primary
    "bookingNote",
    "manageUrl",
  ],
  aliases: {
    startTime: "start",
    endTime:   "end",
  },
  notes: {
    email: "Email templates are HTML. Use <br> for line breaks or proper <p> tags.",
    sms:   "SMS is plain text. Use \\n for line breaks.",
  },
  example: {
    email: `Hi {{firstName}},<br>Your booking is confirmed for {{date}} {{start}}–{{end}} at {{locationName}} (Bay {{bayNumber}}).`,
    sms:   `Hi {{firstName}}\\nYour booking is confirmed\\n{{locationName}} Bay {{bayNumber}}\\n{{date}} {{start}}–{{end}}`,
  },
};