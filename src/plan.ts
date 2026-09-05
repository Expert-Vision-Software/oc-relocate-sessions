import type { DriverDb } from "./driver.js";
import type { PlanCommandOptions } from "./options.js";
import { openGlobalDb, resolveGlobalDb, walWarning } from "./resolve.js";
import { displayPath, normalizeRelocationPaths, type NormalizedRelocationPaths } from "./paths.js";

export interface PlanSessionRow {
  id: string;
  projectId: string;
  directory: string;
  path: string;
}

export interface PlanDirectoryCount {
  directory: string;
  sessions: number;
}

export interface PlanTidyUpCounts {
  project: number;
  projectDirectory: number;
  workspace: number;
}

export interface RelocationPlan {
  db: string;
  from: string;
  to: string;
  toExists: boolean;
  alsoProjectTables: boolean;
  changed: false;
  totals: { sessions: number; directories: number };
  sessions: PlanSessionRow[];
  directories: PlanDirectoryCount[];
  tidyUp?: PlanTidyUpCounts;
}

export async function runPlan(opts: PlanCommandOptions): Promise<number> {
  const paths = normalizeRelocationPaths(opts.from, opts.to);
  const resolution = resolveGlobalDb(opts.dbFlag);
  const opened = await openGlobalDb(resolution);
  const { db } = opened;
  try {
    const warning = walWarning(resolution.path);
    if (warning !== null) {
      process.stderr.write(`${warning}\n`);
    }
    if (!paths.toExists) {
      process.stderr.write(
        `warning: destination path does not exist on disk: ${displayPath(paths.to)} — ` +
          `sessions would point at a path that is not there yet\n`,
      );
    }

    const plan = computePlan(db, paths, opts.alsoProjectTables, resolution.path);

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(formatTextPlan(plan));
    return 0;
  } finally {
    db.close();
  }
}

export function computePlan(
  db: DriverDb,
  paths: NormalizedRelocationPaths,
  alsoProjectTables: boolean,
  dbPath: string,
): RelocationPlan {
  const sessions = readAffectedSessions(db, paths.from);
  const directories = groupByDirectory(sessions);
  const plan: RelocationPlan = {
    db: dbPath,
    from: paths.from,
    to: paths.to,
    toExists: paths.toExists,
    alsoProjectTables,
    changed: false,
    totals: { sessions: sessions.length, directories: directories.length },
    sessions,
    directories,
  };
  if (alsoProjectTables) {
    plan.tidyUp = readTidyUpCounts(db, paths.from);
  }
  return plan;
}

function readAffectedSessions(db: DriverDb, from: string): PlanSessionRow[] {
  const rows = db.all(
    "SELECT id, project_id, directory, path FROM session WHERE directory LIKE ? ESCAPE '\\' ORDER BY directory ASC, id ASC",
    [likePrefix(from)],
  );
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id),
      projectId: String(record.project_id),
      directory: String(record.directory),
      path: String(record.path ?? ""),
    };
  });
}

function groupByDirectory(sessions: PlanSessionRow[]): PlanDirectoryCount[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    counts.set(session.directory, (counts.get(session.directory) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([directory, count]) => ({ directory, sessions: count }))
    .sort((a, b) => b.sessions - a.sessions || compareStrings(a.directory, b.directory));
}

function readTidyUpCounts(db: DriverDb, from: string): PlanTidyUpCounts {
  return {
    project: countRows(
      db,
      "SELECT COUNT(*) AS count FROM project WHERE worktree LIKE ? ESCAPE '\\' OR sandboxes LIKE ? ESCAPE '\\'",
      [likePrefix(from), likeContains(from)],
    ),
    projectDirectory: countRows(
      db,
      "SELECT COUNT(*) AS count FROM project_directory WHERE directory LIKE ? ESCAPE '\\'",
      [likePrefix(from)],
    ),
    workspace: countRows(
      db,
      "SELECT COUNT(*) AS count FROM workspace WHERE directory LIKE ? ESCAPE '\\'",
      [likePrefix(from)],
    ),
  };
}

function countRows(db: DriverDb, sql: string, params: string[]): number {
  const first = db.all(sql, params)[0] as { count: unknown } | undefined;
  return Number(first?.count ?? 0);
}

function likePrefix(value: string): string {
  return `${escapeLike(value)}%`;
}

function likeContains(value: string): string {
  return `%${escapeLike(value)}%`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function formatTextPlan(plan: RelocationPlan): string {
  const lines = [
    `Global DB: ${plan.db}`,
    "Relocation plan (read-only): nothing has been changed",
    `From: ${displayPath(plan.from)}`,
    `To: ${displayPath(plan.to)}`,
    `Affected sessions: ${plan.totals.sessions} across ${plan.totals.directories} directories`,
    "",
    "Affected rows:",
  ];
  if (plan.sessions.length === 0) {
    lines.push("  (none)");
  } else {
    for (const session of plan.sessions) {
      lines.push(`  ${session.id}  ${displayPath(session.directory)}`);
    }
  }
  lines.push("", "Sessions by directory:");
  if (plan.directories.length === 0) {
    lines.push("  (none)");
  } else {
    for (const entry of plan.directories) {
      lines.push(`  ${entry.sessions}  ${displayPath(entry.directory)}`);
    }
  }
  lines.push("", formatTidyUpScope(plan));
  lines.push("No changes were made; run 'relocate' to perform this relocation.");
  return `${lines.join("\n")}\n`;
}

function formatTidyUpScope(plan: RelocationPlan): string {
  if (!plan.tidyUp) {
    return "Tidy-up scope (--also-project-tables): off";
  }
  return [
    "Tidy-up scope (--also-project-tables): on — would also rewrite:",
    `  project: ${plan.tidyUp.project}`,
    `  project_directory: ${plan.tidyUp.projectDirectory}`,
    `  workspace: ${plan.tidyUp.workspace}`,
  ].join("\n");
}
