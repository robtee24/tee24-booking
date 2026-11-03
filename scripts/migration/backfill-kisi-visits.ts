/**
 * Backfill historical Kisi unlocks as Visit rows. Silent: no member email/SMS.
 *
 *   cd repo && set -a; source .env.local; set +a
 *   npx tsx --tsconfig tsconfig.json scripts/migration/backfill-kisi-visits.ts
 */
import fs from "fs";
import { kisiListUnlockEvents } from "@/lib/kisi";
import { ingestKisiUnlock } from "@/services/attendance.service";
import { getPrisma } from "@/lib/db";

const START = new Date("2023-11-01T00:00:00Z");
const END = new Date();
const WINDOW_MS = 80 * 24 * 60 * 60 * 1000; // stay under Kisi's 90-day event-set cap; fewer POSTs
const MAX_EVENTS = 20_000;
const PROGRESS = "/tmp/gymdesk/kisi-backfill-progress.json";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadProgress(): { nextFrom: string | null } {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
  } catch {
    return { nextFrom: null };
  }
}
function saveProgress(nextFrom: Date | null, extra?: Record<string, unknown>) {
  fs.writeFileSync(PROGRESS, JSON.stringify({ nextFrom: nextFrom?.toISOString() ?? null, updatedAt: new Date().toISOString(), ...extra }, null, 2));
}

async function listUnlocks(from: Date, to: Date) {
  let delay = 20_000;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      return await kisiListUnlockEvents({ from, to, maxEvents: MAX_EVENTS });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/429|exceeded/.test(msg) || attempt === 8) throw e;
      console.log(`rate-limited, waiting ${delay / 1000}s (attempt ${attempt})`);
      await sleep(delay);
      delay = Math.min(delay * 2, 180_000);
    }
  }
  return [];
}

async function ingestWindow(
  from: Date,
  to: Date,
  summary: { windows: number; fetched: number; ingested: number; deduped: number; skipped: number; existing: number; capped: number },
) {
  summary.windows++;
  process.stdout.write(`window ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)} … `);
  const events = await listUnlocks(from, to);
  if (events.length >= MAX_EVENTS && to.getTime() - from.getTime() > 60_000) {
    summary.capped++;
    const mid = new Date((from.getTime() + to.getTime()) / 2);
    console.log(`HIT ${MAX_EVENTS} cap — splitting`);
    await ingestWindow(from, mid, summary);
    await ingestWindow(mid, to, summary);
    return;
  }
  events.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  let ingested = 0, deduped = 0, skipped = 0, existing = 0;
  for (const ev of events) {
    if (!ev.success) continue;
    if (ev.object_type && ev.object_type !== "Lock") continue;
    if (!ev.actor_email && ev.actor_id == null) { skipped++; continue; }
    const r = await ingestKisiUnlock(
      {
        kisiEventId: ev.uuid,
        kisiUserId: ev.actor_type === "User" && ev.actor_id != null ? String(ev.actor_id) : null,
        kisiDoorId: String(ev.object_id),
        actorEmail: ev.actor_email,
        actorName: ev.actor_name,
        doorName: ev.object_name,
        kisiPlaceId: ev.place_id,
        unlockedAt: new Date(ev.created_at),
        rawEvent: ev,
      },
      { silent: true },
    );
    if (r.deduped) deduped++;
    else if (r.visitId) ingested++;
    else existing++;
  }
  summary.fetched += events.length;
  summary.ingested += ingested;
  summary.deduped += deduped;
  summary.skipped += skipped;
  summary.existing += existing;
  console.log(`events=${events.length} new=${ingested} deduped=${deduped} anon=${skipped}`);
}

async function main() {
  const prisma = getPrisma();
  const summary = { windows: 0, fetched: 0, ingested: 0, deduped: 0, skipped: 0, existing: 0, capped: 0 };
  const resume = loadProgress().nextFrom;
  let from = new Date(resume && new Date(resume) > START ? resume : START);
  if (resume) console.log("resuming from", from.toISOString().slice(0, 10));
  for (; from < END; from = new Date(from.getTime() + WINDOW_MS)) {
    const to = new Date(Math.min(from.getTime() + WINDOW_MS, END.getTime()));
    await ingestWindow(from, to, summary);
    saveProgress(to, { summary });
    await sleep(8_000);
  }
  const visits = await prisma.visit.groupBy({ by: ["source"], _count: true });
  console.log("done", summary, { visits });
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
