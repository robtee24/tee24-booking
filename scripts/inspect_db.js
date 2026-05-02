// Inspect the actual state of the Supabase DB to figure out how far the
// gym_management_full migration got before it failed.
require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const newTables = [
    "Organization","AdminPermission","AdminNotification","EmergencyContact","FamilyAccount",
    "FamilyMember","MembershipPlan","MembershipPricingOverride","MembershipSubscription",
    "PaymentMethod","Invoice","InvoiceLineItem","Charge","Refund","Discount",
    "DiscountPlanRestriction","DiscountApplication","MemberCredit","Document",
    "DocumentAssignment","SignatureEvent","Tag","MemberTag","CustomFieldDefinition",
    "CustomFieldValue","MemberNote","InternalNote","Visit","UsageTierSnapshot",
    "ChurnRiskScore","ChurnLabel","Visitor","VisitorEvent","SignupForm","MessageTemplate",
    "Conversation","Message","Automation","AutomationStep","AutomationEnrollment",
    "AutomationEvent","Referral","ReferralPayout","PaypalAccount","Task","MaintenanceLog",
    "Checklist","ChecklistRun","AuditLog","WebhookDelivery","MlModel"
  ];
  const tablesExist = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    newTables
  );
  console.log("=== NEW tables that already exist ===");
  console.log(tablesExist.map(r => r.table_name).join("\n") || "(none)");
  console.log("\nCount:", tablesExist.length, "/", newTables.length);

  const memberCols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='Member'
     ORDER BY ordinal_position`
  );
  console.log("\n=== Member columns ===");
  console.log(memberCols.map(r => r.column_name).join(", "));

  const locCols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='Location'
       AND column_name IN ('organizationId','attendanceDedupeHours','reservationMatchBufferMin',
                           'addressLine1','addressLine2','city','state','zip','country')`
  );
  console.log("\n=== Location new columns present ===");
  console.log(locCols.map(r => r.column_name).join(", "));

  const adminCols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='Admin'
       AND column_name IN ('email','twoFactorEnabled','twoFactorSecret','lastLoginAt')`
  );
  console.log("\n=== Admin new columns present ===");
  console.log(adminCols.map(r => r.column_name).join(", "));

  const bookingCols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='Booking' AND column_name='memberId'`
  );
  console.log("\n=== Booking.memberId present? ===");
  console.log(bookingCols.length > 0 ? "YES" : "NO");

  const failed = await prisma.$queryRawUnsafe(
    `SELECT migration_name, finished_at, rolled_back_at, logs
     FROM "_prisma_migrations"
     WHERE migration_name LIKE '20260%'
     ORDER BY started_at`
  );
  console.log("\n=== _prisma_migrations entries for new migrations ===");
  for (const r of failed) {
    console.log(`  ${r.migration_name} finished=${r.finished_at} rolled_back=${r.rolled_back_at}`);
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
