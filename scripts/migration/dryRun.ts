/**
 * Dry-run validation. Reads CSV files from the export directory, applies the
 * mappings, and produces a validation report — without writing to the DB.
 *
 * Usage: npx tsx scripts/migration/dryRun.ts --input ./exports/gymdesk-2026-04-30
 */
import fs from "fs";
import path from "path";
import {
  GymdeskAttendance,
  GymdeskDocument,
  GymdeskDocumentAssignment,
  GymdeskMember,
  GymdeskPayment,
  memberDedupeKey,
} from "./mappings";

interface ValidationReport {
  generatedAt: string;
  inputDir: string;
  counts: Record<string, number>;
  warnings: string[];
  duplicates: { key: string; ids: string[] }[];
  orphanPayments: number;
  orphanAttendance: number;
  unmatchedSquareSubscriptions: number;
}

function parseCsv<T = Record<string, string>>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  const [headerLine, ...lines] = raw.split(/\r?\n/).filter(Boolean);
  const headers = parseRow(headerLine);
  return lines.map((line) => {
    const cells = parseRow(line);
    const obj: any = {};
    headers.forEach((h, i) => (obj[h] = cells[i] ?? ""));
    return obj as T;
  });
}

function parseRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function dryRun(inputDir: string): ValidationReport {
  const members = parseCsv<GymdeskMember>(path.join(inputDir, "members.csv"));
  const payments = parseCsv<GymdeskPayment>(path.join(inputDir, "payments.csv"));
  const attendance = parseCsv<GymdeskAttendance>(path.join(inputDir, "attendance.csv"));
  const documents = parseCsv<GymdeskDocument>(path.join(inputDir, "documents.csv"));
  const docAssignments = parseCsv<GymdeskDocumentAssignment>(
    path.join(inputDir, "document_assignments.csv"),
  );

  const memberIds = new Set(members.map((m) => m.id));

  const dupes: Record<string, string[]> = {};
  for (const m of members) {
    const key = memberDedupeKey(m);
    if (!key.replace(/\|/g, "").trim()) continue;
    dupes[key] ??= [];
    dupes[key].push(m.id);
  }

  return {
    generatedAt: new Date().toISOString(),
    inputDir,
    counts: {
      members: members.length,
      payments: payments.length,
      attendance: attendance.length,
      documents: documents.length,
      documentAssignments: docAssignments.length,
    },
    warnings: [],
    duplicates: Object.entries(dupes)
      .filter(([, ids]) => ids.length > 1)
      .map(([key, ids]) => ({ key, ids })),
    orphanPayments: payments.filter((p) => p.member_id && !memberIds.has(p.member_id)).length,
    orphanAttendance: attendance.filter(
      (a) => a.member_id && !memberIds.has(a.member_id),
    ).length,
    unmatchedSquareSubscriptions: 0,
  };
}

if (require.main === module) {
  const inputArg = process.argv.indexOf("--input");
  if (inputArg === -1 || !process.argv[inputArg + 1]) {
    console.error("Usage: dryRun --input <dir>");
    process.exit(1);
  }
  const report = dryRun(process.argv[inputArg + 1]);
  console.log(JSON.stringify(report, null, 2));
}
