// Find and release any stuck Prisma migration advisory lock.
// Lock id 72707369 is hardcoded by `prisma migrate deploy`.
require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } }, // direct, not pooled
});

(async () => {
  const holders = await prisma.$queryRawUnsafe(`
    SELECT pid, usename, application_name, state, query_start, state_change, query
    FROM pg_locks l
    JOIN pg_stat_activity a USING (pid)
    WHERE l.locktype = 'advisory' AND l.objid = 72707369
  `);
  console.log("Sessions holding the migration advisory lock:");
  console.log(JSON.stringify(holders, null, 2));

  if (holders.length > 0) {
    for (const h of holders) {
      console.log(`Terminating pid ${h.pid}...`);
      await prisma.$queryRawUnsafe(`SELECT pg_terminate_backend(${h.pid})`);
    }
    console.log("Done.");
  } else {
    console.log("No stale lock holders. The lock is free.");
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
