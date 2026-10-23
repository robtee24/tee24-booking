/**
 * GSPro shot-data exports: captured at the bay kiosk, parked in `ShotDataExport`,
 * and pulled into the member app by "Sync latest data" where each file becomes
 * an analyzed PracticeSession and re-tunes the practice plan.
 */
import { getPrisma } from "@/lib/db";
import { parseShotCsv } from "@/lib/practice/gspro-csv";
import { sendEmail } from "@/lib/sendEmail";
import { findMemberByPhone, MobileError } from "@/services/mobile-auth.service";
import { importSwingCsv, regeneratePlan } from "@/services/mobile-practice.service";

export const MAX_EXPORT_BYTES = 2 * 1024 * 1024; // one GSPro session is ~10–100 KB
export const MAX_EXPORT_FILES = 6;

export type KioskExportFile = { name: string; content: string };
export type KioskExportInput = {
  deviceId: string;
  delivery: "APP" | "EMAIL" | "BOTH";
  bookingId?: string | null;
  phone?: string | null;
  email?: string | null;
  files: KioskExportFile[];
};

export class KioskExportError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const digitsOf = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);

function describe(csv: string) {
  const parsed = parseShotCsv(csv);
  const times = parsed.shots.map((s) => s.shotAt?.getTime()).filter((t): t is number => typeof t === "number");
  const clubs = new Map<string, number>();
  for (const s of parsed.shots) clubs.set(s.club, (clubs.get(s.club) ?? 0) + 1);
  const topClubs = [...clubs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
  return { shotCount: parsed.shots.length, playedAt: times.length ? new Date(Math.min(...times)) : null, topClubs };
}

/** Kiosk → server. Stores each CSV and (optionally) emails copies to the player. */
export async function intakeKioskExport(input: KioskExportInput) {
  const prisma = getPrisma();
  const reg = await prisma.bayAppRegistration.findUnique({
    where: { deviceId: input.deviceId },
    include: { location: { select: { id: true, name: true, slug: true, timezone: true } } },
  });
  if (!reg) throw new KioskExportError("Device not registered", 404, "NOT_REGISTERED");
  if (!input.files.length) throw new KioskExportError("No files to export", 400, "NO_FILES");
  if (input.files.length > MAX_EXPORT_FILES) throw new KioskExportError(`Send up to ${MAX_EXPORT_FILES} files at a time`, 400, "TOO_MANY_FILES");

  // Who is this for? Booking → member; else phone; else email.
  let memberId: string | null = null;
  let firstName: string | null = null;
  let memberEmail: string | null = null;
  const phoneDigits = digitsOf(input.phone);

  if (input.bookingId) {
    const b = await prisma.booking.findUnique({ where: { id: input.bookingId }, select: { memberId: true, phone: true, email: true, firstName: true, locationId: true, bayNumber: true } });
    if (b && b.locationId === reg.locationId && b.bayNumber === reg.bayNumber) {
      firstName = b.firstName;
      memberEmail = b.email || null;
      if (b.memberId) memberId = b.memberId;
      else if (!phoneDigits && b.phone) {
        const m = await findMemberByPhone(b.phone);
        if (m) memberId = m.id;
      }
    }
  }
  if (!memberId && phoneDigits.length === 10) {
    const m = await findMemberByPhone(`+1${phoneDigits}`);
    if (m) {
      memberId = m.id;
      firstName = firstName ?? m.firstName;
    }
  }
  if (memberId) {
    const m = await prisma.member.findUnique({ where: { id: memberId }, select: { firstName: true, email: true } });
    firstName = m?.firstName ?? firstName;
    memberEmail = m?.email ?? memberEmail;
  }

  const emailTo = (input.email?.trim() || memberEmail || "").toLowerCase() || null;
  const wantsEmail = input.delivery === "EMAIL" || input.delivery === "BOTH";
  const wantsApp = input.delivery === "APP" || input.delivery === "BOTH";
  if (wantsEmail && (!emailTo || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailTo))) throw new KioskExportError("Enter an email address to send the file to", 400, "EMAIL_REQUIRED");
  if (wantsApp && !memberId && phoneDigits.length !== 10) throw new KioskExportError("Enter the phone number on your Tee24 account so the app can find this data", 400, "PHONE_REQUIRED");

  const rows = [] as { id: string; fileName: string; shotCount: number; topClubs: string[] }[];
  for (const f of input.files) {
    const content = String(f.content ?? "");
    const byteSize = Buffer.byteLength(content, "utf8");
    if (!content.trim()) continue;
    if (byteSize > MAX_EXPORT_BYTES) throw new KioskExportError(`${f.name} is too large (2 MB max)`, 413, "FILE_TOO_LARGE");
    const d = describe(content);
    const row = await prisma.shotDataExport.create({
      data: {
        memberId,
        locationId: reg.locationId,
        bayNumber: reg.bayNumber,
        bookingId: input.bookingId ?? null,
        deviceId: input.deviceId,
        phone: phoneDigits.length === 10 ? phoneDigits : null,
        fileName: String(f.name || "gspro-export.csv").slice(0, 200),
        csvText: content,
        byteSize,
        shotCount: d.shotCount,
        playedAt: d.playedAt,
        delivery: input.delivery,
        emailTo: wantsEmail ? emailTo : null,
        // Email-only exports have nothing for the app to sync.
        status: wantsApp ? "PENDING" : "SKIPPED",
      },
      select: { id: true, fileName: true, shotCount: true },
    });
    rows.push({ ...row, topClubs: d.topClubs });
  }
  if (!rows.length) throw new KioskExportError("Those files were empty", 400, "NO_FILES");

  let emailed = false;
  if (wantsEmail && emailTo) {
    const when = new Date().toLocaleString("en-US", { timeZone: reg.location.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const list = rows.map((r) => `<li>${escapeHtml(r.fileName)} — ${r.shotCount} shot${r.shotCount === 1 ? "" : "s"}${r.topClubs.length ? ` (${escapeHtml(r.topClubs.join(", "))})` : ""}</li>`).join("");
    const res = await sendEmail({
      to: emailTo,
      subject: `Your GSPro shot data from Bay ${reg.bayNumber} · ${reg.location.name}`,
      html: `<p>Hi${firstName ? ` ${escapeHtml(firstName)}` : ""},</p><p>Here's the shot data you exported from Bay ${reg.bayNumber} at ${escapeHtml(reg.location.name)} on ${when}.</p><ul>${list}</ul><p>${wantsApp ? "It's also waiting in the Tee24 app — open Improve and tap <b>Sync latest data</b> to see your analysis." : "Open the Tee24 app, go to Improve → Import GSPro, and pick these files to add them to your practice plan."}</p><p>— Tee24</p>`,
      text: `Your GSPro shot data from Bay ${reg.bayNumber} at ${reg.location.name} (${when}) is attached.`,
      attachments: input.files.filter((f) => String(f.content ?? "").trim()).map((f) => ({ filename: String(f.name || "gspro-export.csv").slice(0, 200), content: Buffer.from(f.content, "utf8").toString("base64") })),
      tags: [{ name: "kind", value: "shot_export" }],
    });
    emailed = !!res.ok;
    if (emailed) await prisma.shotDataExport.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { emailedAt: new Date() } });
    else console.warn("[shot-export] email failed", res.error);
  }

  return {
    ok: true as const,
    exports: rows,
    member: memberId ? { id: memberId, firstName } : null,
    matched: !!memberId,
    emailedTo: emailed ? emailTo : null,
    pendingForApp: wantsApp,
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/* ---------------- Member app side ---------------- */

export type ExportView = {
  id: string;
  fileName: string;
  shotCount: number;
  playedAt: string | null;
  createdAt: string;
  status: string;
  bayNumber: number;
  location: { id: string; name: string; slug: string } | null;
  sessionId: string | null;
  error: string | null;
};

/** Attach any unclaimed exports typed in with this member's phone number(s). */
async function claimByPhone(memberId: string) {
  const prisma = getPrisma();
  const m = await prisma.member.findUnique({ where: { id: memberId }, select: { phone: true, secondaryPhones: true } });
  if (!m) return;
  const phones = new Set<string>();
  const p = digitsOf(m.phone);
  if (p.length === 10) phones.add(p);
  for (const sp of Array.isArray(m.secondaryPhones) ? (m.secondaryPhones as unknown[]) : []) {
    const d = digitsOf(typeof sp === "string" ? sp : "");
    if (d.length === 10) phones.add(d);
  }
  if (!phones.size) return;
  await prisma.shotDataExport.updateMany({ where: { memberId: null, phone: { in: [...phones] } }, data: { memberId } });
}

export async function listExports(memberId: string, opts: { includeDone?: boolean } = {}) {
  const prisma = getPrisma();
  await claimByPhone(memberId);
  const rows = await prisma.shotDataExport.findMany({
    where: { memberId, ...(opts.includeDone ? {} : { status: "PENDING" }) },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, fileName: true, shotCount: true, playedAt: true, createdAt: true, status: true, bayNumber: true, locationId: true, sessionId: true, error: true },
  });
  const locIds = [...new Set(rows.map((r) => r.locationId))];
  const locs = locIds.length ? await prisma.location.findMany({ where: { id: { in: locIds } }, select: { id: true, name: true, slug: true } }) : [];
  const byId = new Map(locs.map((l) => [l.id, l]));
  const exports: ExportView[] = rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    shotCount: r.shotCount,
    playedAt: r.playedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    status: r.status,
    bayNumber: r.bayNumber,
    location: byId.get(r.locationId) ?? null,
    sessionId: r.sessionId,
    error: r.error,
  }));
  return { exports, pendingCount: exports.filter((e) => e.status === "PENDING").length };
}

/** Import every pending export for this member, then re-tune the plan once. */
export async function syncExports(memberId: string) {
  const prisma = getPrisma();
  await claimByPhone(memberId);
  const pending = await prisma.shotDataExport.findMany({
    where: { memberId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { id: true, fileName: true, csvText: true, locationId: true, bayNumber: true, playedAt: true, createdAt: true },
  });
  if (!pending.length) return { imported: [], failed: [], skipped: [], pendingCount: 0, plan: null, planChanged: false };

  const locs = await prisma.location.findMany({ where: { id: { in: [...new Set(pending.map((p) => p.locationId))] } }, select: { id: true, name: true } });
  const locName = new Map(locs.map((l) => [l.id, l.name]));

  const imported: { id: string; sessionId: string; fileName: string; shotCount: number; title: string | null }[] = [];
  const failed: { id: string; fileName: string; error: string }[] = [];
  const skipped: { id: string; fileName: string; reason: string }[] = [];

  for (const ex of pending) {
    // Claim atomically so a double-tap on "Sync" can't import the same file twice.
    const claimed = await prisma.shotDataExport.updateMany({ where: { id: ex.id, status: "PENDING" }, data: { status: "IMPORTING" } });
    if (!claimed.count) continue;
    try {
      const r = await importSwingCsv(memberId, {
        csv: ex.csvText,
        fileName: ex.fileName,
        locationId: ex.locationId,
        playedAt: (ex.playedAt ?? ex.createdAt).toISOString(),
        title: `Bay ${ex.bayNumber}${locName.get(ex.locationId) ? ` · ${locName.get(ex.locationId)}` : ""}`,
        notes: "Synced from the bay kiosk.",
      });
      await prisma.shotDataExport.update({ where: { id: ex.id }, data: { status: "IMPORTED", sessionId: r.session.id, importedAt: new Date(), error: null } });
      imported.push({ id: ex.id, sessionId: r.session.id, fileName: ex.fileName, shotCount: r.session.shotCount, title: r.session.title });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      const noShots = err instanceof MobileError && err.code === "NO_SHOTS";
      await prisma.shotDataExport.update({ where: { id: ex.id }, data: { status: noShots ? "SKIPPED" : "FAILED", error: msg.slice(0, 500) } });
      if (noShots) skipped.push({ id: ex.id, fileName: ex.fileName, reason: msg });
      else failed.push({ id: ex.id, fileName: ex.fileName, error: msg });
    }
  }

  // importSwingCsv re-tunes per file; one final pass keeps the plan consistent across the batch.
  let plan = null;
  let planChanged = false;
  if (imported.length) {
    const hasProfile = await prisma.practiceProfile.count({ where: { memberId } });
    if (hasProfile) {
      const prev = await prisma.practicePlan.findFirst({ where: { memberId, active: true }, select: { focusAreas: true } });
      plan = await regeneratePlan(memberId, "import");
      const prevKeys = ((prev?.focusAreas as { key: string }[] | undefined) ?? []).map((f) => f.key).join("|");
      planChanged = prevKeys !== (plan.focusAreas as { key: string }[]).map((f) => f.key).join("|");
    }
  }
  const pendingCount = await prisma.shotDataExport.count({ where: { memberId, status: "PENDING" } });
  return { imported, failed, skipped, pendingCount, plan, planChanged };
}

export async function deleteExport(memberId: string, id: string) {
  const prisma = getPrisma();
  const r = await prisma.shotDataExport.deleteMany({ where: { id, memberId, status: { in: ["PENDING", "FAILED", "SKIPPED"] } } });
  if (!r.count) throw new MobileError("Export not found", 404, "NOT_FOUND");
  return { id };
}
