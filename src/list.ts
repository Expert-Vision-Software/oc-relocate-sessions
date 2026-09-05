import type { DriverDb } from "./driver.js";
import { openGlobalDb, resolveGlobalDb, walWarning } from "./resolve.js";

export interface ListOptions {
  json: boolean;
  dbFlag?: string;
}

interface DirectoryCount {
  directory: string;
  sessions: number;
}

interface ListReport {
  db: string;
  totals: { projects: number; sessions: number; directories: number };
  directories: DirectoryCount[];
}

export async function runList(opts: ListOptions): Promise<number> {
  const resolution = resolveGlobalDb(opts.dbFlag);
  const opened = await openGlobalDb(resolution);
  const { db } = opened;
  try {
    const warning = walWarning(resolution.path);
    if (warning !== null) {
      process.stderr.write(`${warning}\n`);
    }

    const directories = readDirectoryCounts(db);
    const totals = {
      projects: readCount(db, "project"),
      sessions: readCount(db, "session"),
      directories: directories.length,
    };
    const report: ListReport = { db: resolution.path, totals, directories };

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(formatTextReport(report));
    return 0;
  } finally {
    db.close();
  }
}

function readDirectoryCounts(db: DriverDb): DirectoryCount[] {
  const rows = db.all(
    "SELECT directory, COUNT(*) AS sessions FROM session GROUP BY directory ORDER BY sessions DESC, directory ASC",
  );
  return rows.map((row) => {
    const record = row as { directory: unknown; sessions: unknown };
    return { directory: String(record.directory), sessions: Number(record.sessions) };
  });
}

function readCount(db: DriverDb, table: "project" | "session"): number {
  const rows = db.all(`SELECT COUNT(*) AS count FROM ${table}`);
  const first = rows[0] as { count: unknown } | undefined;
  return Number(first?.count ?? 0);
}

function formatTextReport(report: ListReport): string {
  const lines = [
    `Global DB: ${report.db}`,
    `Projects: ${report.totals.projects} · Sessions: ${report.totals.sessions} across ${report.totals.directories} directories`,
    "",
    "Sessions by directory:",
  ];
  if (report.directories.length === 0) {
    lines.push("  (none)");
  } else {
    for (const entry of report.directories) {
      lines.push(`  ${entry.sessions}  ${entry.directory}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
