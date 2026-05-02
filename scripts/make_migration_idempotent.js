// One-shot rewriter that converts the gym_management_full migration into an
// idempotent form so it can be safely re-run when a previous migration has
// already added some of the same Member columns.
const fs = require("fs");
const path = require("path");

const FILE = "prisma/migrations/20260501220000_gym_management_full/migration.sql";
const src = fs.readFileSync(FILE, "utf8");

let out = src;

out = out.replace(/^CREATE TABLE "([^"]+)" \(/gm, 'CREATE TABLE IF NOT EXISTS "$1" (');

out = out.replace(/^CREATE INDEX "([^"]+)"/gm, 'CREATE INDEX IF NOT EXISTS "$1"');
out = out.replace(/^CREATE UNIQUE INDEX "([^"]+)"/gm, 'CREATE UNIQUE INDEX IF NOT EXISTS "$1"');

out = out.replace(
  /^ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"/gm,
  'ALTER TABLE "$1" ADD COLUMN IF NOT EXISTS "$2"',
);

// FKs: Postgres has no `ADD CONSTRAINT IF NOT EXISTS`. Wrap each in an
// anonymous DO block that swallows duplicate-object errors. The original line
// looks like:
//   ALTER TABLE "X" ADD CONSTRAINT "X_y_fkey" FOREIGN KEY (...) REFERENCES ... ;
out = out.replace(
  /^(ALTER TABLE "[^"]+" ADD CONSTRAINT "[^"]+" FOREIGN KEY [^;]+;)/gm,
  (m) => `DO $$ BEGIN ${m} EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
);

fs.writeFileSync(FILE, out);
console.log("Rewrote", FILE);
