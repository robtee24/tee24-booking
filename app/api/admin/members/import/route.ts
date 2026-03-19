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
      const statusRaw = findField(row, "status", "memberstatus", "type", "membertype");
      const membershipType = findField(row, "membership", "membershiptype", "plan", "membershipplan");
      const joinDateRaw = findField(row, "joindate", "joined", "startdate", "datejoined", "createddate");
      const gymDeskId = findField(row, "id", "memberid", "gymdeskid");

      const status = normalizeStatus(statusRaw);
      let joinDate: Date | null = null;
      if (joinDateRaw) {
        const d = new Date(joinDateRaw);
        if (!isNaN(d.getTime())) joinDate = d;
      }

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
              phone: phone || existing.phone,
              status,
              membershipType: membershipType || existing.membershipType,
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
              phone,
              status,
              membershipType: membershipType || null,
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
