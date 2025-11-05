// prisma/seed.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import pkg from "@prisma/client";
const { PrismaClient, AdminRole } = pkg;

const prisma = new PrismaClient();

async function seedLocationClarksville() {
  const existing = await prisma.location.findUnique({
    where: { slug: "clarksville" },
  });

  if (existing) {
    console.log("ℹ️ Location 'clarksville' already seeded, skipping.");
    return;
  }

  const location = await prisma.location.create({
    data: {
      name: "Tee24 Clarksville",
      slug: "clarksville",
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
    update: { role: AdminRole.ROOT },
    create: {
      phone: ROOT_PHONE,
      role: AdminRole.ROOT,
      name: "Root Admin",
    },
  });

  console.log(`✅ Seeded/updated root admin: ${admin.phone} (role: ${admin.role})`);
}

async function main() {
  await seedLocationClarksville();
  await seedRootAdmin();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
