// lib/prisma.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("DATABASE_URL is not set in environment variables");
}

/**
 * If the URL is a file path (likely SQLite) use the schema default.
 * Otherwise override the datasource URL (PostgreSQL, MySQL, ...)
 */
const isFile = dbUrl.startsWith("file:");
const overrideConfig = isFile
  ? undefined
  : {
      datasources: {
        db: { url: dbUrl },
      },
    };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
    ...(overrideConfig ?? {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;