import { spawnSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { CliError } from "./errors.js";
import { openDatabase, type DriverDb } from "./driver.js";
import type { RelocateCommandOptions } from "./options.js";
import { displayPath, normalizeRelocationPaths, type NormalizedRelocationPaths } from "./paths.js";
import {
  computePlan,
  escapeLike,
  formatTextPlan,
  likePrefix,
  type PlanDirectoryCount,
  type RelocationPlan,
} from "./plan.js";
import { openGlobalDb, resolveGlobalDb, walWarning, WAL_ANY_BYTES } from "./resolve.js";

export const PROCESS_DETECTOR_OUTPUT_ENV = "OC_RELOCATE_PROCESS_DETECTOR_OUTPUT";

interface ProcessGuard {
  running: boolean;
  detail: string | null;
}

interface RelocateChanges {
  session: number;
  projectWorktree?: number;
  projectSandboxes?: number;
  projectDirectory?: number;
  workspace?: number;
}

interface ApplyOutcome {
  backup: string;
  changes: RelocateChanges;
  directoriesAfter: PlanDirectoryCount[];
}

interface DetectorResult {
  output: string | null;
  failure: string | null;
}

const ESCAPE = "ESCAPE '\\'";

const SESSION_UPDATE = `UPDATE session SET directory = REPLACE(directory, ?, ?) WHERE directory LIKE ? ${ESCAPE}`;
const PROJECT_WORKTREE_UPDATE = `UPDATE project SET worktree = REPLACE(worktree, ?, ?) WHERE worktree LIKE ? ${ESCAPE}`;
const PROJECT_SANDBOXES_UPDATE = `UPDATE project SET sandboxes = REPLACE(sandboxes, ?, ?) WHERE sandboxes LIKE ? ${ESCAPE}`;
const PROJECT_DIRECTORY_UPDATE = `UPDATE project_directory SET directory = REPLACE(directory, ?, ?) WHERE directory LIKE ? ${ESCAPE}`;
const WORKSPACE_UPDATE = `UPDATE workspace SET directory = REPLACE(directory, ?, ?) WHERE directory LIKE ? ${ESCAPE}`;

function realDetectorOutput(): DetectorResult {
  const command =
    process.platform === "win32"
      ? ["tasklist", "/FI", "IMAGENAME eq opencode.exe", "/FO", "CSV", "/NH"]
      : ["pgrep", "-x", "opencode"];
  try {
    const result = spawnSync(command[0]!, command.slice(1), {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    if (result.error !== undefined) {
      return { output: null, failure: result.error.message };
    }
    return { output: typeof result.stdout === "string" ? result.stdout : null, failure: null };
  } catch (err) {
    return { output: null, failure: err instanceof Error ? err.message : String(err) };
  }
}

function isDetectorHit(line: string): boolean {
  if (/^INFO:/i.test(line)) return false;
  if (/opencode\.exe/i.test(line)) return true;
  return /^\d+$/.test(line);
}

function detectorLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && isDetectorHit(line));
}

export function detectOpenCodeProcesses(): ProcessGuard {
  const faked = process.env[PROCESS_DETECTOR_OUTPUT_ENV];
  const result: DetectorResult = faked !== undefined ? { output: faked, failure: null } : realDetectorOutput();
  if (result.failure !== null) {
    process.stderr.write(
      `warning: could not check for running opencode processes (${result.failure}) — the process guard was skipped\n`,
    );
  }
  if (result.output === null) return { running: false, detail: null };
  const matches = detectorLines(result.output);
  if (matches.length === 0) return { running: false, detail: null };
  return { running: true, detail: matches.join(", ") };
}

export function backupPathFor(dbPath: string, now: Date = new Date()): string {
  return `${dbPath}.bak-relocate-${now.toISOString().replaceAll(":", "-")}`;
}

function runUpdate(db: DriverDb, sql: string, paths: NormalizedRelocationPaths, matchPattern: string): number {
  const result = db.run(sql, [paths.from, paths.to, matchPattern]);
  return Number(result.changes ?? 0);
}

function likeContains(value: string): string {
  return `%${escapeLike(value)}%`;
}

function readDirectoriesAfter(db: DriverDb, to: string): PlanDirectoryCount[] {
  const rows = db.all(
    `SELECT directory, COUNT(*) AS sessions FROM session WHERE directory LIKE ? ${ESCAPE} GROUP BY directory ORDER BY sessions DESC, directory ASC`,
    [likePrefix(to)],
  );
  return rows.map((row) => {
    const record = row as { directory: unknown; sessions: unknown };
    return { directory: String(record.directory), sessions: Number(record.sessions) };
  });
}

function enforceGuard(force: boolean): void {
  const guard = detectOpenCodeProcesses();
  if (!guard.running) return;
  if (!force) {
    throw new CliError(
      `opencode appears to be running (${guard.detail}) — close it before relocating, ` +
        `or rerun with --force to proceed anyway`,
    );
  }
  process.stderr.write(
    `warning: opencode appears to be running (${guard.detail}) — --force overrode the process guard; ` +
      `concurrent writes may corrupt the Global DB\n`,
  );
}

function writeRelocation(
  db: DriverDb,
  paths: NormalizedRelocationPaths,
  alsoProjectTables: boolean,
  plannedSessions: number,
): RelocateChanges {
  db.exec("BEGIN IMMEDIATE");
  try {
    const changes: RelocateChanges = { session: runUpdate(db, SESSION_UPDATE, paths, likePrefix(paths.from)) };
    if (alsoProjectTables) {
      changes.projectWorktree = runUpdate(db, PROJECT_WORKTREE_UPDATE, paths, likePrefix(paths.from));
      changes.projectSandboxes = runUpdate(db, PROJECT_SANDBOXES_UPDATE, paths, likeContains(paths.from));
      changes.projectDirectory = runUpdate(db, PROJECT_DIRECTORY_UPDATE, paths, likePrefix(paths.from));
      changes.workspace = runUpdate(db, WORKSPACE_UPDATE, paths, likePrefix(paths.from));
    }
    if (changes.session !== plannedSessions) {
      throw new CliError(
        `verification failed: applied ${changes.session} session changes but the plan expected ${plannedSessions}`,
      );
    }
    db.exec("COMMIT");
    return changes;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}

async function performApply(
  dbPath: string,
  paths: NormalizedRelocationPaths,
  alsoProjectTables: boolean,
  plannedSessions: number,
  force: boolean,
): Promise<ApplyOutcome> {
  enforceGuard(force);
  const advisory = walWarning(dbPath, WAL_ANY_BYTES);
  if (advisory !== null) {
    process.stderr.write(`${advisory}\n`);
  }

  const backup = backupPathFor(dbPath);
  copyFileSync(dbPath, backup);
  try {
    const opened = await openDatabase(dbPath, { readonly: false });
    try {
      const changes = writeRelocation(opened.db, paths, alsoProjectTables, plannedSessions);
      const directoriesAfter = readDirectoriesAfter(opened.db, paths.to);
      return { backup, changes, directoriesAfter };
    } finally {
      opened.db.close();
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CliError(
      `${reason}\nNothing was committed; the pre-write backup is at ${displayPath(backup)}`,
    );
  }
}

function tidyUpMatches(plan: RelocationPlan): number {
  if (!plan.tidyUp) return 0;
  return plan.tidyUp.project.count + plan.tidyUp.projectDirectory.count + plan.tidyUp.workspace.count;
}

function noApplyTargets(plan: RelocationPlan): boolean {
  return plan.totals.sessions === 0 && tidyUpMatches(plan) === 0;
}

export interface RelocationRequest {
  from: string;
  to: string;
  dbFlag?: string;
  alsoProjectTables: boolean;
  apply: boolean;
  force: boolean;
}

export interface RelocationNoop {
  kind: "noop";
  db: string;
  paths: NormalizedRelocationPaths;
  plan: RelocationPlan;
}

export interface RelocationApplied {
  kind: "applied";
  db: string;
  paths: NormalizedRelocationPaths;
  plan: RelocationPlan;
  backup: string;
  changes: RelocateChanges;
  directoriesAfter: PlanDirectoryCount[];
}

export type RelocationOutcome = RelocationNoop | RelocationApplied;

export async function executeRelocation(request: RelocationRequest): Promise<RelocationOutcome> {
  const paths = normalizeRelocationPaths(request.from, request.to);
  const resolution = resolveGlobalDb(request.dbFlag);
  const opened = await openGlobalDb(resolution);
  let plan: RelocationPlan;
  try {
    plan = computePlan(opened.db, paths, request.alsoProjectTables, resolution.path);
  } finally {
    opened.db.close();
  }

  if (!paths.toExists) {
    process.stderr.write(
      `warning: destination path does not exist on disk: ${displayPath(paths.to)} — ` +
        `sessions would point at a path that is not there yet\n`,
    );
  }

  if (!request.apply || noApplyTargets(plan)) {
    return { kind: "noop", db: resolution.path, paths, plan };
  }

  const outcome = await performApply(
    resolution.path,
    paths,
    request.alsoProjectTables,
    plan.totals.sessions,
    request.force,
  );
  return { kind: "applied", db: resolution.path, paths, plan, ...outcome };
}

export async function runRelocate(opts: RelocateCommandOptions): Promise<number> {
  const outcome = await executeRelocation(opts);

  if (outcome.kind === "noop" && !opts.apply) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(outcome.plan, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(
      formatTextPlan(outcome.plan, "No changes were made; rerun with --apply to perform this relocation."),
    );
    return 0;
  }

  if (outcome.kind === "noop") {
    const message = `No sessions match ${displayPath(outcome.paths.from)} — nothing to relocate.`;
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            db: outcome.db,
            from: outcome.paths.from,
            to: outcome.paths.to,
            toExists: outcome.paths.toExists,
            changed: false,
            planned: outcome.plan.totals,
            changes: { session: 0 },
            verify: { applied: 0, planned: outcome.plan.totals.sessions },
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }
    process.stdout.write(`${message}\n`);
    return 0;
  }

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          db: outcome.db,
          from: outcome.paths.from,
          to: outcome.paths.to,
          toExists: outcome.paths.toExists,
          changed: true,
          backup: outcome.backup,
          force: opts.force,
          planned: outcome.plan.totals,
          changes: outcome.changes,
          verify: { applied: outcome.changes.session, planned: outcome.plan.totals.sessions },
          directories: outcome.directoriesAfter,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const lines = [
    `Global DB: ${outcome.db}`,
    `Backup: ${displayPath(outcome.backup)}`,
    `Relocated ${outcome.changes.session} sessions from ${displayPath(outcome.paths.from)} to ${displayPath(outcome.paths.to)}`,
    "",
    "Sessions by directory (after relocation):",
  ];
  if (outcome.directoriesAfter.length === 0) {
    lines.push("  (none)");
  } else {
    for (const entry of outcome.directoriesAfter) {
      lines.push(`  ${entry.sessions}  ${displayPath(entry.directory)}`);
    }
  }
  lines.push(
    "",
    `Verified: ${outcome.changes.session} of ${outcome.plan.totals.sessions} planned session changes applied.`,
  );
  if (opts.alsoProjectTables) {
    lines.push(
      `Tidy-up rows rewritten: project.worktree ${outcome.changes.projectWorktree ?? 0}, ` +
        `project.sandboxes ${outcome.changes.projectSandboxes ?? 0}, ` +
        `project_directory ${outcome.changes.projectDirectory ?? 0}, ` +
        `workspace ${outcome.changes.workspace ?? 0}`,
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
