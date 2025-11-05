// lib/prisma.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const rawUrl = process.env.DATABASE_URL;

if (!rawUrl) {
  throw new Error("DATABASE_URL is not set in environment variables");
}

/**
 * Normalise SQLite URLs:
 *   file:dev.db          → file:./prisma/dev.db
 *   file:/abs/path.db    → unchanged
 *   ./dev.db             → file:./dev.db
 */
let url = rawUrl.trim();

if (!url.startsWith("file:") && !url.startsWith("postgres")) {
  // Relative path without protocol → assume SQLite
  url = `file:${url.startsWith("/") ? "" : "./"}${url}`;
}

// ---- Validation -------------------------------------------------
if (url.startsWith("file:")) {
  // SQLite – nothing else to check
  console.log("Prisma: Using SQLite →", url);
} else if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
  console.log("Prisma: Using PostgreSQL →", url);
} else {
  throw new Error(
    `Invalid DATABASE_URL: "${rawUrl}".\n` +
      `Must start with "file:" (SQLite) or "postgres://" (PostgreSQL).`
  );
}

// force connection-pool mode for serverless ----
const isServerless = !!process.env.VERCEL || !!process.env.NETLIFY;
const prismaOptions: Parameters<typeof PrismaClient>[0] = {
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "info", "warn", "error"]
      : ["error"],
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...prismaOptions,
    datasources: { db: { url } }, // runtime override
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;