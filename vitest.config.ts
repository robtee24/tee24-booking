import { defineConfig } from "vitest/config";
import path from "node:path";

// LEAGUE_SMOKE_DIR: optional absolute path to an out-of-repo folder of DB-backed
// smoke tests (run against a scratch database, never production).
const extra = process.env.LEAGUE_SMOKE_DIR ? [`${process.env.LEAGUE_SMOKE_DIR}/**/*.test.ts`] : [];

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    include: ["lib/**/*.test.ts", "services/**/*.test.ts", ...extra],
    environment: "node",
    fileParallelism: false,
  },
});
