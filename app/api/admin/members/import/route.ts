import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS_MAP: Record<string, string> = {
  active: "ACTIVE",
  cancelled: "CANCELLED",
  canceled: "CANCELLED",
  frozen: "FROZEN",
  visitor: "VISITOR",
  "website signup": "VISITOR",
};

function normalizeStatus(raw: string | undefined): string {
  if (!raw) return "ACTIVE";
  return STATUS_MAP[raw.toLowerCase().trim()] ?? "ACTIVE";
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]/g, "")
  );

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] || "").trim();
    }
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

function findField(row: Record<string, string>, ...candidates: string[]): string {
  for (const c of candidates) {
    const key = c.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return "";
}

// Gymdesk membership pricing lookup (normalized title → { fees, recurrence })
const MEMBERSHIP_PRICING: Record<string, { fees: string; recurrence: string }> = {
  "$250 pga membership": { fees: "$250.00", recurrence: "month" },
  "ca discount - noonan ( limited membership 3x per month)": { fees: "$42.00", recurrence: "month" },
  "ca discount - noonan (limited membership 3x per month)": { fees: "$42.00", recurrence: "month" },
  "ca discount - tin cup / mcavoy (unlimited membership)": { fees: "$70.00", recurrence: "month" },
  "ca discount - tin cup / mcavoy + guest (unlimited membership)": { fees: "$87.50", recurrence: "month" },
  "gilmore unlimited day pass | 24 hour door access sent after purchase": { fees: "$50.00", recurrence: "one-time" },
  "lessons | 10 pack": { fees: "$600.00", recurrence: "one-time" },
  "lessons | 5 pack": { fees: "$350.00", recurrence: "one-time" },
  "lessons | single lesson (45 min)": { fees: "$85.00", recurrence: "one-time" },
  "noonan ( limited membership 3x per month)": { fees: "$60.00", recurrence: "month" },
  "noonan (limited membership 3x per month)": { fees: "$60.00", recurrence: "month" },
  "tin cup / mcavoy (unlimited membership)": { fees: "$100.00", recurrence: "month" },
  "tin cup / mcavoy + guest (unlimited membership)": { fees: "$125.00", recurrence: "month" },
  "tin cup / mcavoy + guest discounted | first responder | vet | senior | students (unlimited membership)": { fees: "$95.00", recurrence: "month" },
  "waiting list - refundable deposit - applied toward first month": { fees: "$50.00", recurrence: "one-time" },
};

function lookupPricing(title: string): { fees: string; recurrence: string } | null {
  const key = title.toLowerCase().trim();
  if (MEMBERSHIP_PRICING[key]) return MEMBERSHIP_PRICING[key];
  for (const [k, v] of Object.entries(MEMBERSHIP_PRICING)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

/**
 * Parse a Gymdesk membership field like:
 *   "Tin Cup / McAvoy + Guest (Unlimited Membership), 03/18/2026"
 *   "Noonan ( Limited Membership 3x per month), 03/17/2026 (2 / 3  sessions)"
 * Returns { title, startDate }
 */
function parseMembershipField(raw: string): { title: string; startDate: string | null } {
  if (!raw) return { title: "", startDate: null };
  const dateMatch = raw.match(/,\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (dateMatch) {
    const title = raw.substring(0, dateMatch.index!).trim();
    return { title, startDate: dateMatch[1] };
  }
  return { title: raw.trim(), startDate: null };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const locationSlug = formData.get("locationSlug") as string | null;

    if (!file || !locationSlug) {
      return NextResponse.json(
        { error: "file and locationSlug are required" },
        { status: 400 }
      );
    }

    const location = await getPrisma().location.findUnique({
      where: { slug: locationSlug },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const text = await file.text();
    const rows = parseCSV(text);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const email = findField(row, "email", "emailaddress", "mail").toLowerCase().trim();
      if (!email) {
        skipped++;
        continue;
      }

      const firstName = findField(row, "firstname", "first", "fname");
      const lastName = findField(row, "lastname", "last", "lname");
      const phone = findField(row, "phone", "phonenumber", "mobile", "cell");
      const statusRaw = findField(row, "status", "memberstatus");
      const typeRaw = findField(row, "type");
      const membershipRaw = findField(row, "membership", "membershiptype", "plan", "membershipplan");
      const joinDateRaw = findField(row, "joindate", "joined", "startdate", "datejoined", "createddate");
      const gymDeskId = findField(row, "id", "memberid", "gymdeskid");
      const dobRaw = findField(row, "dateofbirth", "dob", "birthday");
      const gender = findField(row, "gender");

      const { title: membershipType, startDate: membershipStartRaw } = parseMembershipField(membershipRaw);
      const pricing = membershipType ? lookupPricing(membershipType) : null;

      let status = normalizeStatus(statusRaw);
      if (status === "ACTIVE" && typeRaw.toLowerCase() === "visitor") {
        status = "VISITOR";
      }

      function parseDateField(raw: string): Date | null {
        if (!raw) return null;
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
      }

      const joinDate = parseDateField(joinDateRaw);
      const dob = parseDateField(dobRaw);
      const membershipStartDate = parseDateField(membershipStartRaw ?? "");

      const fullName = firstName && lastName ? `${firstName} ${lastName}` : null;

      try {
        const existing = await getPrisma().member.findUnique({
          where: { locationId_email: { locationId: location.id, email } },
        });

        if (existing) {
          await getPrisma().member.update({
            where: { id: existing.id },
            data: {
              firstName: firstName || existing.firstName,
              lastName: lastName || existing.lastName,
              fullName: fullName || existing.fullName,
              phone: phone || existing.phone,
              dob: dob ?? existing.dob,
              gender: gender || existing.gender,
              status,
              membershipType: membershipType || existing.membershipType,
              membershipStartDate: membershipStartDate ?? existing.membershipStartDate,
              membershipFees: pricing?.fees ?? existing.membershipFees,
              membershipRecurrence: pricing?.recurrence ?? existing.membershipRecurrence,
              joinDate: joinDate ?? existing.joinDate,
              gymDeskId: gymDeskId || existing.gymDeskId,
              source: "CSV",
            },
          });
          updated++;
        } else {
          await getPrisma().member.create({
            data: {
              locationId: location.id,
              email,
              firstName,
              lastName,
              fullName,
              phone,
              dob,
              gender: gender || null,
              status,
              membershipType: membershipType || null,
              membershipStartDate,
              membershipFees: pricing?.fees ?? null,
              membershipRecurrence: pricing?.recurrence ?? null,
              joinDate,
              gymDeskId: gymDeskId || null,
              source: "CSV",
            },
          });
          created++;
        }
      } catch (e) {
        console.error(`[CSV import] Error on row email=${email}:`, e);
        skipped++;
      }
    }

    return NextResponse.json({
      ok: true,
      total: rows.length,
      created,
      updated,
      skipped,
    });
  } catch (e: any) {
    console.error("[CSV import] Error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Import failed" },
      { status: 500 }
    );
  }
}
