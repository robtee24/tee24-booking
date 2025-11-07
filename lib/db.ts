// lib/db.ts
import { PrismaClient } from "@prisma/client";

/**
 * Global type extension – safe, only used inside function
 */
declare global {
  // eslint-disable-next-line no-var
  var __PRISMA__: PrismaClient | undefined;
}

/**
 * Cached PrismaClient instance
 */
let cachedPrisma: PrismaClient | undefined;

/**
 * Get (or create) a singleton PrismaClient.
 * Safe for:
 * - Turbopack dev (no top-level `global`)
 * - Hot reload (singleton in dev)
 * - Production (one per process)
 */
export function getPrisma(): PrismaClient {
  if (cachedPrisma) {
    return cachedPrisma;
  }

  // Only access `global` here — runs on server only
  const globalWithPrisma = globalThis as unknown as {
    __PRISMA__?: PrismaClient;
  };

  const prisma =
    globalWithPrisma.__PRISMA__ ||
    new PrismaClient({
      log:
        process.env.NODE_ENV === "development"
          ? ["query", "error", "warn"]
          : ["error"],
    });

  // Cache in module scope
  cachedPrisma = prisma;

  // Cache in global for hot-reload in dev
  if (process.env.NODE_ENV !== "production") {
    globalWithPrisma.__PRISMA__ = prisma;
  }

  return prisma;
}