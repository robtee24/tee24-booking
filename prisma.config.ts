// prisma.config.ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

// This config is only used by the Prisma CLI (migrate/generate), never by the
// runtime client, which reads DATABASE_URL from schema.prisma. Migrations must
// use the direct (session-mode) connection: `prisma migrate deploy` takes a
// Postgres advisory lock, which times out behind Supabase's transaction pooler
// (port 6543) and intermittently fails the Vercel build.
const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DIRECT_URL / DATABASE_URL is not set in environment variables");
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  engine: 'classic',
  datasource: {
    url: databaseUrl,
  },
});