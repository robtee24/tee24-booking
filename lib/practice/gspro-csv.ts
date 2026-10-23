/**
 * Parse GSPro shot-data exports (and most launch-monitor CSVs) into a
 * normalized shot list.
 *
 * GSPro's "Export Shot Data" writes one row per shot with columns such as
 *   Shot, Club, Ball Speed, Launch Angle, Launch Direction, Back Spin, Side Spin,
 *   Spin Axis, Total Spin, Carry, Total, Offline, Peak Height, Descent Angle,
 *   Club Speed, Smash Factor, Club Path, Face Angle, Face To Path,
 *   Angle Of Attack, Dynamic Loft, Date/Time
 * Column names vary by version and by launch monitor (SkyTrak, Uneekor,
 * ProTee VX, Rapsodo…), so headers are matched by normalized aliases and
 * units are detected from the header text ("(m/s)", "(m)").
 */

export type ParsedShot = {
  club: string;
  ballSpeed: number | null;
  clubSpeed: number | null;
  smashFactor: number | null;
  launchAngle: number | null;
  launchDir: number | null;
  backSpin: number | null;
  sideSpin: number | null;
  spinAxis: number | null;
  carry: number | null;
  total: number | null;
  offline: number | null;
  apex: number | null;
  descentAngle: number | null;
  clubPath: number | null;
  faceAngle: number | null;
  faceToPath: number | null;
  attackAngle: number | null;
  dynamicLoft: number | null;
  shotAt: Date | null;
  raw: Record<string, string>;
};

type Field = Exclude<keyof ParsedShot, "raw" | "shotAt" | "club">;

const ALIASES: Record<Field | "club" | "shotAt", string[]> = {
  club: ["club", "clubname", "clubtype", "selectedclub"],
  ballSpeed: ["ballspeed", "ballspeedmph", "ballmph", "speed", "ballvelocity"],
  clubSpeed: ["clubspeed", "clubheadspeed", "clubspeedmph", "chs", "swingspeed"],
  smashFactor: ["smashfactor", "smash", "efficiency"],
  launchAngle: ["launchangle", "vla", "verticallaunch", "verticallaunchangle", "launch"],
  launchDir: ["launchdirection", "hla", "horizontallaunch", "horizontallaunchangle", "launchdir", "direction", "azimuth"],
  backSpin: ["backspin", "backspinrpm", "spin", "spinrate", "totalspin"],
  sideSpin: ["sidespin", "sidespinrpm"],
  spinAxis: ["spinaxis", "axis", "spinaxisdeg"],
  carry: ["carry", "carrydistance", "carryyds", "carryyards", "carrydist"],
  total: ["total", "totaldistance", "totalyds", "totalyards", "distance"],
  offline: ["offline", "offlinedistance", "sidedistance", "lateral", "lateraldistance", "deviation", "side"],
  apex: ["apex", "peakheight", "maxheight", "height", "apexheight"],
  descentAngle: ["descentangle", "landangle", "landingangle", "descent"],
  clubPath: ["clubpath", "path", "swingpath"],
  faceAngle: ["faceangle", "face", "clubface", "faceangleatimpact"],
  faceToPath: ["facetopath", "ftp", "facetopathdeg"],
  attackAngle: ["angleofattack", "attackangle", "aoa"],
  dynamicLoft: ["dynamicloft", "dloft", "loft"],
  shotAt: ["datetime", "date", "time", "timestamp", "shottime", "created"],
};

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");

function detectDelimiter(line: string) {
  const counts = { ",": (line.match(/,/g) ?? []).length, ";": (line.match(/;/g) ?? []).length, "\t": (line.match(/\t/g) ?? []).length };
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",") as "," | ";" | "\t";
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === delim && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function num(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.replace(/[^0-9.\-+eE]/g, "");
  if (!s || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function normalizeClub(raw: string): string {
  const s = raw.trim();
  if (!s) return "Unknown";
  const l = s.toLowerCase().replace(/\s+/g, " ");
  if (/^(dr|driver|1w|1 wood)$/.test(l) || l.includes("driver")) return "Driver";
  const wood = l.match(/^(\d)\s*(w|wood|fw)$/) ?? l.match(/^(\d)w$/);
  if (wood) return `${wood[1]} Wood`;
  const hy = l.match(/^(\d)\s*(h|hy|hybrid|rescue)$/) ?? l.match(/^(\d)h$/);
  if (hy) return `${hy[1]} Hybrid`;
  const iron = l.match(/^(\d)\s*(i|iron)$/) ?? l.match(/^(\d)i$/);
  if (iron) return `${iron[1]} Iron`;
  if (/^(pw|pitching wedge|p wedge|p)$/.test(l)) return "PW";
  if (/^(gw|aw|gap wedge|approach wedge|a wedge|uw)$/.test(l)) return "GW";
  if (/^(sw|sand wedge|s wedge)$/.test(l)) return "SW";
  if (/^(lw|lob wedge|l wedge)$/.test(l)) return "LW";
  const deg = l.match(/^(\d{2})\s*(°|deg|degree|degrees|w|wedge)?$/);
  if (deg) {
    const d = Number(deg[1]);
    if (d >= 44 && d <= 64) return d <= 47 ? "PW" : d <= 52 ? "GW" : d <= 57 ? "SW" : "LW";
  }
  if (l.includes("putt")) return "Putter";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export type ClubGroup = "driver" | "wood" | "hybrid" | "long_iron" | "mid_iron" | "short_iron" | "wedge" | "putter" | "other";

export function clubGroup(club: string): ClubGroup {
  const c = club.toLowerCase();
  if (c === "driver") return "driver";
  if (c.endsWith("wood")) return "wood";
  if (c.endsWith("hybrid")) return "hybrid";
  const iron = c.match(/^(\d) iron$/);
  if (iron) {
    const n = Number(iron[1]);
    return n <= 5 ? "long_iron" : n <= 7 ? "mid_iron" : "short_iron";
  }
  if (["pw", "gw", "sw", "lw"].includes(c)) return "wedge";
  if (c === "putter") return "putter";
  return "other";
}

export type ParseResult = { shots: ParsedShot[]; columns: string[]; unmatched: string[]; unitNotes: string[] };

export function parseShotCsv(text: string): ParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { shots: [], columns: [], unmatched: [], unitNotes: [] };

  // Header may not be the first line (GSPro sometimes writes a title row).
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const n = norm(lines[i]!);
    if (n.includes("club") || n.includes("ballspeed") || n.includes("carry")) {
      headerIdx = i;
      break;
    }
  }
  const delim = detectDelimiter(lines[headerIdx]!);
  const headers = splitLine(lines[headerIdx]!, delim);
  const normHeaders = headers.map(norm);

  // Column → field map (first alias match wins; exact before fuzzy)
  const colFor = new Map<string, number>();
  const unmatched: string[] = [];
  for (const [field, aliases] of Object.entries(ALIASES) as [keyof typeof ALIASES, string[]][]) {
    let idx = normHeaders.findIndex((h) => aliases.includes(h));
    if (idx < 0) idx = normHeaders.findIndex((h) => aliases.some((a) => a.length > 3 && h.startsWith(a)));
    if (idx >= 0 && ![...colFor.values()].includes(idx)) colFor.set(field, idx);
  }
  headers.forEach((h, i) => {
    if (![...colFor.values()].includes(i)) unmatched.push(h);
  });

  // Unit detection from header text
  const unitNotes: string[] = [];
  const hdr = (field: string) => (colFor.has(field) ? headers[colFor.get(field)!]!.toLowerCase() : "");
  const speedMs = /m\/s|mps|kph|km\/h/.test(hdr("ballSpeed")) || /m\/s|mps/.test(hdr("clubSpeed"));
  const speedKph = /kph|km\/h/.test(hdr("ballSpeed"));
  const distMeters = /\(m\)|meters|metres/.test(hdr("carry")) || /\(m\)|meters|metres/.test(hdr("total"));
  if (speedMs) unitNotes.push(speedKph ? "Speeds converted from km/h to mph" : "Speeds converted from m/s to mph");
  if (distMeters) unitNotes.push("Distances converted from meters to yards");
  const spd = (v: number | null) => (v == null ? null : speedKph ? v * 0.621371 : speedMs ? v * 2.23694 : v);
  const dist = (v: number | null) => (v == null ? null : distMeters ? v * 1.09361 : v);

  const shots: ParsedShot[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]!, delim);
    if (cells.every((c) => !c)) continue;
    const get = (f: string) => (colFor.has(f) ? cells[colFor.get(f)!] : undefined);
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => (raw[h] = cells[idx] ?? ""));

    const ballSpeed = spd(num(get("ballSpeed")));
    const clubSpeed = spd(num(get("clubSpeed")));
    const carry = dist(num(get("carry")));
    if (ballSpeed == null && carry == null) continue; // not a shot row (summary line etc.)

    let smash = num(get("smashFactor"));
    if (smash == null && ballSpeed != null && clubSpeed != null && clubSpeed > 0) smash = Math.round((ballSpeed / clubSpeed) * 1000) / 1000;
    if (smash != null && (smash < 0.8 || smash > 1.7)) smash = null;

    let faceToPath = num(get("faceToPath"));
    const faceAngle = num(get("faceAngle"));
    const clubPath = num(get("clubPath"));
    if (faceToPath == null && faceAngle != null && clubPath != null) faceToPath = Math.round((faceAngle - clubPath) * 10) / 10;

    let shotAt: Date | null = null;
    const ts = get("shotAt");
    if (ts) {
      const d = new Date(ts);
      shotAt = Number.isNaN(d.getTime()) ? null : d;
    }

    shots.push({
      club: normalizeClub(get("club") ?? "Unknown"),
      ballSpeed,
      clubSpeed,
      smashFactor: smash,
      launchAngle: num(get("launchAngle")),
      launchDir: num(get("launchDir")),
      backSpin: num(get("backSpin")),
      sideSpin: num(get("sideSpin")),
      spinAxis: num(get("spinAxis")),
      carry,
      total: dist(num(get("total"))),
      offline: dist(num(get("offline"))),
      apex: dist(num(get("apex"))),
      descentAngle: num(get("descentAngle")),
      clubPath,
      faceAngle,
      faceToPath,
      attackAngle: num(get("attackAngle")),
      dynamicLoft: num(get("dynamicLoft")),
      shotAt,
      raw,
    });
  }

  return { shots, columns: headers, unmatched, unitNotes };
}
