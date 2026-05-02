/**
 * Parallel sync — pulls Gymdesk delta (members updated since last run) and
 * applies it to Tee24. Designed to run on a 15-minute cron during the 2-week
 * parallel window before cutover.
 *
 * In production we'll either:
 *   - hit Gymdesk's API (if available), or
 *   - re-export to a watched directory and replay through `runImport`.
 *
 * This script is a thin orchestrator that runs the importer with a since-marker.
 */
import fs from "fs";
import path from "path";
import { runImport } from "./import";

const MARKER = path.join(process.cwd(), ".migration-sync-marker");

async function main() {
  const inputDir = process.env.MIGRATION_INPUT_DIR;
  if (!inputDir) {
    console.error("MIGRATION_INPUT_DIR required");
    process.exit(1);
  }

  const since = fs.existsSync(MARKER) ? fs.readFileSync(MARKER, "utf8").trim() : null;
  const summary = await runImport(inputDir);
  fs.writeFileSync(MARKER, new Date().toISOString());

  console.log(JSON.stringify({ since, summary }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
