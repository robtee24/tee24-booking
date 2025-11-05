// prisma/prisma.config.ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const isProduction = process.env.NODE_ENV === "production";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",

  // override in production
  ...(isProduction && {
    datasource: {
      url: env("DATABASE_URL"),
    },
  }),
});