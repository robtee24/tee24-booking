// prisma/seed.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import pkg from "@prisma/client";
const { PrismaClient, AdminRole } = pkg;

const prisma = new PrismaClient();

// Reasonable default weekly hours (07:00–22:00 daily)
const defaultHours: any = {
  mon: { open: true, from: "07:00", to: "22:00" },
  tue: { open: true, from: "07:00", to: "22:00" },
  wed: { open: true, from: "07:00", to: "22:00" },
  thu: { open: true, from: "07:00", to: "22:00" },
  fri: { open: true, from: "07:00", to: "22:00" },
  sat: { open: true, from: "07:00", to: "22:00" },
  sun: { open: true, from: "07:00", to: "22:00" },
};

const defaultEmailTpl =
  '<p>Hi {{firstName}},</p>' +
  '<p>Confirmed for {{date}} {{startTime}}–{{endTime}} at <strong>{{locationName}}</strong>, Bay {{bayNumber}}.</p>' +
  '<p>{{bookingNote}}</p>' +
  '<p>Manage: <a href="{{manageUrl}}">{{manageUrl}}</a></p>';

const defaultSmsTpl =
  'Tee24: {{firstName}} your bay {{bayNumber}} at {{locationName}} is booked for {{date}} {{startTime}}–{{endTime}}. Manage: {{manageUrl}}';

async function seedLocationClarksville() {
  const existing = await prisma.location.findUnique({ where: { slug: "clarksville" } });

  if (existing) {
    console.log("ℹ️ Location 'clarksville' already exists, ensuring required fields…");

    // Make sure required/new fields exist on old records too
    await prisma.location.update({
      where: { id: existing.id },
      data: {
        hours: (existing as any).hours ?? defaultHours,
        bookingNote: (existing as any).bookingNote ?? "",
        emailTemplate: (existing as any).emailTemplate ?? defaultEmailTpl,
        smsTemplate: (existing as any).smsTemplate ?? defaultSmsTpl,
      },
    });

    console.log("✅ Location 'clarksville' updated/verified.");
    return;
  }

  const location = await prisma.location.create({
    data: {
      name: "Tee24 Clarksville",
      slug: "clarksville",
      hours: defaultHours,             // ✅ REQUIRED JSON FIELD
      bookingNote: "",                 // optional but useful default
      bays: { create: [{ number: 1 }, { number: 2 }, { number: 3 }] },
    },
    include: { bays: true },
  });

  console.log(`✅ Seeded location: ${location.name} (${location.bays.length} bays)`);
}

async function seedRootAdmin() {
  const ROOT_PHONE = process.env.ROOT_ADMIN_PHONE;
  if (!ROOT_PHONE) {
    console.log("⚠️  Skipping root admin seed: set ROOT_ADMIN_PHONE in .env.local");
    return;
  }

  const admin = await prisma.admin.upsert({
    where: { phone: ROOT_PHONE },
    update: { role: AdminRole.ROOT, name: "Root Admin" },
    create: { phone: ROOT_PHONE, role: AdminRole.ROOT, name: "Root Admin" },
  });

  console.log(`✅ Seeded/updated root admin: ${admin.phone} (role: ${admin.role})`);
}

async function main() {
  await seedLocationClarksville();
  await seedRootAdmin();
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
