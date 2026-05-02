// Sanity test for the pooled DATABASE_URL.
//
// We deliberately fire many concurrent queries that each rely on prepared
// statements. If `?pgbouncer=true` is missing or the URL is wrong, this surfaces
// "prepared statement already exists" errors on the second wave.
require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  console.log("DATABASE_URL host:", new URL(process.env.DATABASE_URL).host);

  const t0 = Date.now();
  const counts = await Promise.all(
    Array.from({ length: 20 }, () =>
      Promise.all([
        prisma.booking.count(),
        prisma.member.count(),
        prisma.location.count(),
        prisma.bay.count(),
        prisma.invoice.count(),
        prisma.visit.count(),
      ]),
    ),
  );
  const elapsed = Date.now() - t0;

  const last = counts[counts.length - 1];
  console.log(`\nRan 20 × 6 = 120 queries through the pooler in ${elapsed}ms`);
  console.log("Sample row counts (last batch):", {
    bookings: last[0],
    members: last[1],
    locations: last[2],
    bays: last[3],
    invoices: last[4],
    visits: last[5],
  });

  await prisma.$disconnect();
  console.log("\nPooled connection: OK");
})().catch((e) => {
  console.error("Pooled connection FAILED:", e.message);
  process.exit(1);
});
