import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getPrisma } from "@/lib/db";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";
import { generateCheckinCode } from "@/services/member.service";

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
  "gilmore unlimited day pass | 24 hour door access sent after purchase": { fees: "$50.00", recurrence: "1-day pass" },
  "lessons | 10 pack": { fees: "$600.00", recurrence: "month" },
  "lessons | 5 pack": { fees: "$350.00", recurrence: "month" },
  "lessons | single lesson (45 min)": { fees: "$85.00", recurrence: "month" },
  "noonan ( limited membership 3x per month)": { fees: "$60.00", recurrence: "month" },
  "noonan (limited membership 3x per month)": { fees: "$60.00", recurrence: "month" },
  "tin cup / mcavoy (unlimited membership)": { fees: "$100.00", recurrence: "month" },
  "tin cup / mcavoy + guest (unlimited membership)": { fees: "$125.00", recurrence: "month" },
  "tin cup / mcavoy + guest discounted | first responder | vet | senior | students (unlimited membership)": { fees: "$95.00", recurrence: "month" },
  "waiting list - refundable deposit - applied toward first month": { fees: "$50.00", recurrence: "month" },
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

type Provider = "gymdesk" | "generic";

/**
 * Generic mapping (header → field). Accepts the documented columns:
 *   first_name,last_name,email,phone,dob,joined,status,tags
 * plus a handful of common aliases.
 */
function readGenericRow(row: Record<string, string>) {
  return {
    firstName: findField(row, "first_name", "firstname", "first"),
    lastName: findField(row, "last_name", "lastname", "last"),
    email: findField(row, "email", "email_address").toLowerCase().trim(),
    phone: findField(row, "phone", "phone_number", "mobile"),
    dobRaw: findField(row, "dob", "date_of_birth", "birthday"),
    joinDateRaw: findField(row, "joined", "join_date", "joined_at", "created"),
    statusRaw: findField(row, "status"),
    tagsRaw: findField(row, "tags", "tag"),
    gender: findField(row, "gender"),
    membershipType: findField(row, "membership", "plan"),
    externalId: findField(row, "id", "external_id", "member_id"),
  };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const locationSlug = formData.get("locationSlug") as string | null;
    const provider: Provider = String(formData.get("provider") ?? "gymdesk").toLowerCase() === "generic" ? "generic" : "gymdesk";
    const dryRun = String(formData.get("dryRun") ?? "") === "1";

    if (!file || !locationSlug) {
      return NextResponse.json(
        { error: "file and locationSlug are required" },
        { status: 400 }
      );
    }
    const guard = await requireLocationApi({ locationSlug });
    if (!guard.ok) return guard.response;
    const actor = await getActorContext();
    try {
      assertCan(actor, "member.edit", { locationId: guard.location.id });
    } catch {
      return NextResponse.json({ error: "You don't have permission to import members" }, { status: 403 });
    }

    const location = await getPrisma().location.findUnique({
      where: { slug: locationSlug },
      select: { id: true, organizationId: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const text = await file.text();
    const rows = parseCSV(text);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ row: number; email: string; error: string }> = [];
    const tagCache = new Map<string, string>();

    async function ensureTag(name: string): Promise<string> {
      const key = name.toLowerCase();
      const hit = tagCache.get(key);
      if (hit) return hit;
      const existing = await getPrisma().tag.findFirst({ where: { organizationId: location!.organizationId, name: { equals: name, mode: "insensitive" } } });
      const tag = existing ?? (await getPrisma().tag.create({ data: { organizationId: location!.organizationId, name, color: "#16a34a" } }));
      tagCache.set(key, tag.id);
      return tag.id;
    }

    function parseDateField(raw: string): Date | null {
      if (!raw) return null;
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNo = i + 2; // header is line 1

      let email: string;
      let firstName: string;
      let lastName: string;
      let phone: string;
      let status: string;
      let membershipType = "";
      let membershipStartDate: Date | null = null;
      let pricing: { fees: string; recurrence: string } | null = null;
      let joinDate: Date | null;
      let dob: Date | null;
      let gender: string;
      let gymDeskId = "";
      let tagNames: string[] = [];

      if (provider === "generic") {
        const g = readGenericRow(row);
        email = g.email;
        firstName = g.firstName;
        lastName = g.lastName;
        phone = g.phone;
        status = normalizeStatus(g.statusRaw || "active");
        if ((g.statusRaw || "").toLowerCase() === "pending") status = "PENDING";
        joinDate = parseDateField(g.joinDateRaw);
        dob = parseDateField(g.dobRaw);
        gender = g.gender;
        membershipType = g.membershipType;
        gymDeskId = g.externalId;
        tagNames = g.tagsRaw.split(/[;|,]/).map((t) => t.trim()).filter(Boolean);
      } else {
        email = findField(row, "email", "emailaddress", "mail").toLowerCase().trim();
        firstName = findField(row, "firstname", "first", "fname");
        lastName = findField(row, "lastname", "last", "lname");
        phone = findField(row, "phone", "phonenumber", "mobile", "cell");
        const statusRaw = findField(row, "status", "memberstatus");
        const typeRaw = findField(row, "type");
        const membershipRaw = findField(row, "membership", "membershiptype", "plan", "membershipplan");
        const joinDateRaw = findField(row, "joindate", "joined", "startdate", "datejoined", "createddate");
        gymDeskId = findField(row, "id", "memberid", "gymdeskid");
        const dobRaw = findField(row, "dateofbirth", "dob", "birthday");
        gender = findField(row, "gender");
        const tagsRaw = findField(row, "tags", "tag");
        tagNames = tagsRaw.split(/[;|,]/).map((t) => t.trim()).filter(Boolean);

        const parsed = parseMembershipField(membershipRaw);
        membershipType = parsed.title;
        pricing = membershipType ? lookupPricing(membershipType) : null;

        status = normalizeStatus(statusRaw);
        if (status === "ACTIVE" && typeRaw.toLowerCase() === "visitor") status = "VISITOR";
        if (membershipType.toLowerCase().includes("gilmore unlimited day pass")) status = "VISITOR";

        joinDate = parseDateField(joinDateRaw);
        dob = parseDateField(dobRaw);
        membershipStartDate = parseDateField(parsed.startDate ?? "");
      }

      if (!email) {
        skipped++;
        if (errors.length < 200) errors.push({ row: rowNo, email: "", error: "Missing email" });
        continue;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        skipped++;
        if (errors.length < 200) errors.push({ row: rowNo, email, error: "Invalid email" });
        continue;
      }

      const fullName = firstName && lastName ? `${firstName} ${lastName}` : null;

      try {
        const existing = await getPrisma().member.findUnique({
          where: { locationId_email: { locationId: location.id, email } },
        });

        if (dryRun) {
          if (existing) updated++; else created++;
          continue;
        }

        let memberId: string;
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
          memberId = existing.id;
          updated++;
        } else {
          const m = await getPrisma().member.create({
            data: {
              locationId: location.id,
              organizationId: location.organizationId,
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
              checkinCode: await generateCheckinCode(location.id).catch(() => null),
            },
          });
          memberId = m.id;
          created++;
          void emitMemberEvent("member.created", { memberId: m.id, locationId: location.id, organizationId: location.organizationId, actorAdminId: guard.admin.id, vars: { source: "CSV", provider } });
        }

        for (const name of tagNames) {
          const tagId = await ensureTag(name);
          await getPrisma().memberTag.upsert({
            where: { memberId_tagId: { memberId, tagId } },
            create: { memberId, tagId, taggedById: guard.admin.id },
            update: {},
          });
        }
      } catch (e: any) {
        console.error(`[CSV import] Error on row email=${email}:`, e);
        skipped++;
        if (errors.length < 200) errors.push({ row: rowNo, email, error: e?.message ?? "Row failed" });
      }
    }

    if (!dryRun) {
      void audit({
        organizationId: location.organizationId,
        actorId: guard.admin.id,
        actorRole: guard.admin.role,
        action: "member.update",
        entityType: "Location",
        entityId: location.id,
        metadata: { event: "member.import", provider, total: rows.length, created, updated, skipped, fileName: file.name },
      });
    }

    return NextResponse.json({
      ok: true,
      provider,
      dryRun,
      total: rows.length,
      created,
      updated,
      skipped,
      errors,
    });
  } catch (e: any) {
    console.error("[CSV import] Error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Import failed" },
      { status: 500 }
    );
  }
}
