/**
 * Cutover orchestrator. Runs the final delta import + a post-cutover
 * verification report. Intended to be invoked manually during the maintenance
 * window after writes have been frozen in Gymdesk.
 *
 * Usage: npx tsx scripts/migration/cutover.ts --input ./exports/gymdesk-cutover
 */
import { runImport } from "./import";
import { dryRun } from "./dryRun";
import { getPrisma } from "../../lib/db";

async function main() {
  const inputArg = process.argv.indexOf("--input");
  if (inputArg === -1 || !process.argv[inputArg + 1]) {
    console.error("Usage: cutover --input <dir>");
    process.exit(1);
  }
  const dir = process.argv[inputArg + 1];

  console.log("== Pre-cutover dry run ==");
  console.log(JSON.stringify(dryRun(dir).counts, null, 2));

  console.log("== Running final import ==");
  const summary = await runImport(dir);
  console.log(JSON.stringify(summary, null, 2));

  console.log("== Post-cutover counts ==");
  const prisma = getPrisma();
  const counts = await Promise.all([
    prisma.member.count(),
    prisma.invoice.count().catch(() => 0),
    prisma.charge.count().catch(() => 0),
    prisma.visit.count().catch(() => 0),
  ]);
  console.log(
    JSON.stringify(
      {
        members: counts[0],
        invoices: counts[1],
        charges: counts[2],
        visits: counts[3],
      },
      null,
      2,
    ),
  );

  console.log("== Begin 2-week hyper-care window ==");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
