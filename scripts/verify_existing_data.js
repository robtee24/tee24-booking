require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const counts = {
    bookings: await prisma.booking.count(),
    locations: await prisma.location.count(),
    admins: await prisma.admin.count(),
    bays: await prisma.bay.count(),
    notifications: await prisma.notification.count(),
    members: await prisma.member.count(),
  };
  console.log("=== Existing data preserved ===");
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }

  const newCounts = {
    membershipPlans: await prisma.membershipPlan.count(),
    invoices: await prisma.invoice.count(),
    visits: await prisma.visit.count(),
    documents: await prisma.document.count(),
    automations: await prisma.automation.count(),
    auditLogs: await prisma.auditLog.count(),
    mlModels: await prisma.mlModel.count(),
  };
  console.log("\n=== New tables (expected to be empty) ===");
  for (const [k, v] of Object.entries(newCounts)) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
