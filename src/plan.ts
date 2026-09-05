import type { DriverDb } from "./driver.js";
import type { PlanCommandOptions } from "./options.js";
import { openResolvedDb } from "./resolve.js";
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

export interface PlanTidyUpTable {
  count: number;
  ids: string[];
}

export interface PlanTidyUpCounts {
  project: PlanTidyUpTable;
  projectDirectory: PlanTidyUpTable;
  workspace: PlanTidyUpTable;
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
  const opened = await openResolvedDb(opts.dbFlag);
  const { db, resolution } = opened;
  try {
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
    project: readTidyUpTable(
      db,
      "SELECT id FROM project WHERE worktree LIKE ? ESCAPE '\\' OR sandboxes LIKE ? ESCAPE '\\' ORDER BY id ASC",
      [likePrefix(from), likeContains(from)],
    ),
    projectDirectory: readTidyUpTable(
      db,
      "SELECT id FROM project_directory WHERE directory LIKE ? ESCAPE '\\' ORDER BY id ASC",
      [likePrefix(from)],
    ),
    workspace: readTidyUpTable(
      db,
      "SELECT id FROM workspace WHERE directory LIKE ? ESCAPE '\\' ORDER BY id ASC",
      [likePrefix(from)],
    ),
  };
}

function readTidyUpTable(db: DriverDb, sql: string, params: string[]): PlanTidyUpTable {
  const rows = db.all(sql, params);
  return {
    count: rows.length,
    ids: rows.map((row) => String((row as Record<string, unknown>).id)),
  };
}

export function likePrefix(value: string): string {
  return `${escapeLike(value)}%`;
}

function likeContains(value: string): string {
  return `%${escapeLike(value)}%`;
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function formatTextPlan(plan: RelocationPlan, closingNote: string = DEFAULT_PLAN_CLOSING): string {
  const lines = formatPlanBody(plan);
  lines.push(closingNote);
  return `${lines.join("\n")}\n`;
}

export const DEFAULT_PLAN_CLOSING = "No changes were made; run 'relocate' to perform this relocation.";

export function formatPlanBody(plan: RelocationPlan): string[] {
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
  return lines;
}

function formatTidyUpScope(plan: RelocationPlan): string {
  if (!plan.tidyUp) {
    return "Tidy-up scope (--also-project-tables): off";
  }
  const tidyUp = plan.tidyUp;
  return [
    "Tidy-up scope (--also-project-tables): on — would also rewrite:",
    `  project: ${formatTidyUpTable(tidyUp.project)}`,
    `  project_directory: ${formatTidyUpTable(tidyUp.projectDirectory)}`,
    `  workspace: ${formatTidyUpTable(tidyUp.workspace)}`,
  ].join("\n");
}

function formatTidyUpTable(table: PlanTidyUpTable): string {
  if (table.ids.length === 0) return "0";
  return `${table.count} (${table.ids.join(", ")})`;
}
