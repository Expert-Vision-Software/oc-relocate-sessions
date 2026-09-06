import * as p from "@clack/prompts";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { openDatabase } from "./driver.js";
import { CliError } from "./errors.js";
import { printHelp } from "./help.js";
import { runList } from "./list.js";
import { writeOut } from "./output.js";
import { displayPath, normalizePathInput, normalizeRelocationPaths } from "./paths.js";
import { computePlan, formatPlanBody } from "./plan.js";
import {
  discoverDbCandidates,
  opencodeDataDir,
} from "./resolve.js";
import { executeRelocation } from "./relocate.js";
import { VERSION } from "./version.js";

const MANUAL = "__manual__";

type MenuAction = "relocate" | "inspect" | "help" | "version";

class FlowCancelled extends Error {}

class FlowError extends Error {}

async function ask<T>(prompt: Promise<T | symbol>): Promise<T> {
  const result = await prompt;
  if (p.isCancel(result)) {
    throw new FlowCancelled();
  }
  return result as T;
}

async function askNormalizedPath(message: string): Promise<string> {
  for (;;) {
    const raw = await ask(p.text({ message, placeholder: "C:/path/to/repo" }));
    const value = String(raw).trim();
    if (value.length === 0) {
      p.log.error("Path must not be empty");
      continue;
    }
    try {
      return normalizePathInput(value, process.cwd());
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err));
    }
  }
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `'${value}'` : value;
}

function directCommand(args: readonly string[]): string {
  return ["oc-relocate", ...args.map(quoteIfNeeded)].join(" ");
}

interface RecommendationInput {
  dbPath: string;
  from: string;
  to: string;
  alsoProjectTables: boolean;
}

function recommendation(command: "plan" | "relocate", input: RecommendationInput): string {
  return directCommand([
    command,
    "--from",
    input.from,
    "--to",
    input.to,
    "--db",
    input.dbPath,
    ...(input.alsoProjectTables ? ["--also-project-tables"] : []),
    ...(command === "relocate" ? ["--apply"] : []),
  ]);
}

interface PickOption {
  value: string;
  label: string;
  hint?: string;
}

async function selectOrManual(message: string, options: PickOption[], manualMessage: string): Promise<string> {
  if (options.length === 0) {
    return await askNormalizedPath(manualMessage);
  }
  const withManual: PickOption[] = [...options, { value: MANUAL, label: "Enter a path manually…" }];
  const picked = await ask(p.select({ message, options: withManual }));
  if (picked === MANUAL) {
    return await askNormalizedPath(manualMessage);
  }
  return picked;
}

async function pickDb(message: string): Promise<string> {
  const candidates = discoverDbCandidates();
  if (candidates.length === 0) {
    throw new FlowError(
      `No Global DB found in ${opencodeDataDir()} — install opencode first, or use a direct command with --db`,
    );
  }
  if (candidates.length === 1) {
    const only = candidates[0]!;
    p.log.info(`Global DB: ${only.path} (channel ${only.channel})`);
    return only.path;
  }
  const options: PickOption[] = candidates.map((candidate) => ({
    value: candidate.path,
    label: displayPath(candidate.path),
    hint: `channel ${candidate.channel} · modified ${candidate.mtime}`,
  }));
  return await selectOrManual(message, options, message);
}

async function seedOldPaths(dbPath: string): Promise<string[]> {
  const opened = await openDatabase(dbPath, { readonly: true });
  try {
    const rows = opened.db.all(
      "SELECT DISTINCT directory AS path FROM project_directory " +
        "UNION SELECT DISTINCT worktree FROM project WHERE worktree IS NOT NULL AND TRIM(worktree) <> '' " +
        "ORDER BY path ASC",
    );
    return rows.map((row) => String((row as { path: unknown }).path));
  } finally {
    opened.db.close();
  }
}

async function pickOldPath(dbPath: string): Promise<string> {
  const message = "Step 2/6 · Relocate from which directory?";
  const seeded = await seedOldPaths(dbPath);
  const options = seeded.map((directory) => ({ value: directory, label: displayPath(directory) }));
  return await selectOrManual(message, options, message);
}

function probeNewPathCandidates(from: string): string[] {
  try {
    const parent = dirname(from);
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name).replaceAll("\\", "/"))
      .filter((path) => path !== from)
      .sort()
      .slice(0, 20);
  } catch {
    return [];
  }
}

async function pickNewPath(from: string): Promise<string> {
  const message = "Step 3/6 · Relocate to which directory?";
  const options = probeNewPathCandidates(from).map((directory) => ({
    value: directory,
    label: displayPath(directory),
  }));
  return await selectOrManual(message, options, message);
}

async function relocateFlow(): Promise<number> {
  const dbPath = await pickDb("Step 1/6 · Which Global DB?");
  const from = await pickOldPath(dbPath);
  const to = await pickNewPath(from);

  const alsoProjectTables = await ask(
    p.confirm({
      message: "Step 4/6 · Also rewrite project/workspace bookkeeping rows? (tidy-up)",
      initialValue: false,
    }),
  );

  let plan;
  try {
    const paths = normalizeRelocationPaths(from, to);
    const opened = await openDatabase(dbPath, { readonly: true });
    try {
      plan = computePlan(opened.db, paths, alsoProjectTables, dbPath);
    } finally {
      opened.db.close();
    }
  } catch (err) {
    throw new FlowError(err instanceof Error ? err.message : String(err));
  }

  p.note(formatPlanBody(plan).join("\n"), "Step 5/6 · Live plan preview (read-only)");

  if (plan.totals.sessions === 0 && !plan.tidyUp) {
    p.log.warn("No sessions match — nothing to relocate.");
    p.log.message(recommendation("plan", { dbPath, from: plan.from, to: plan.to, alsoProjectTables }));
    return 0;
  }

  const apply = await ask(
    p.confirm({
      message: `Step 6/6 · Apply this relocation? ${plan.totals.sessions} sessions will be rewritten — a backup is created first`,
      initialValue: false,
    }),
  );
  if (!apply) {
    p.log.info("Nothing was changed.");
    p.log.message(recommendation("plan", { dbPath, from: plan.from, to: plan.to, alsoProjectTables }));
    return 0;
  }

  const spinner = p.spinner();
  spinner.start("Backing up the Global DB…");
  let outcome;
  try {
    outcome = await executeRelocation({
      from,
      to,
      dbFlag: dbPath,
      alsoProjectTables,
      apply: true,
      force: false,
    });
  } catch (err) {
    spinner.stop("Stopped — nothing was committed if the write failed");
    p.log.error(err instanceof Error ? err.message : String(err));
    p.log.message(recommendation("plan", { dbPath, from: plan.from, to: plan.to, alsoProjectTables }));
    return 1;
  }
  spinner.stop("Relocation applied");

  if (outcome.kind === "noop") {
    p.log.warn("No sessions match — nothing to relocate.");
    p.log.message(recommendation("plan", { dbPath, from: plan.from, to: plan.to, alsoProjectTables }));
    return 0;
  }

  p.log.success(
    `Relocated ${outcome.changes.session} sessions — verified: ${outcome.changes.session} of ${outcome.plan.totals.sessions} planned changes applied.`,
  );
  p.note(
    [
      `Backup: ${displayPath(outcome.backup)}`,
      "Sessions by directory (after relocation):",
      ...outcome.directoriesAfter.map((entry) => `  ${entry.sessions}  ${displayPath(entry.directory)}`),
    ].join("\n"),
  );
  p.log.message("Run the same relocation directly next time:");
  p.log.message(recommendation("relocate", { dbPath, from: outcome.paths.from, to: outcome.paths.to, alsoProjectTables }));
  return 0;
}

async function inspectFlow(): Promise<void> {
  const dbPath = await pickDb("Inspect which Global DB?");
  await runList({ json: false, dbFlag: dbPath });
}

export async function runMenu(): Promise<number> {
  p.intro(`oc-relocate v${VERSION}`);
  let hadError = false;
  try {
    for (;;) {
      const action = await ask<MenuAction>(
        p.select<MenuAction>({
          message: "What would you like to do?",
          options: [
            { value: "relocate", label: "Relocate sessions", hint: "guided move to a new repo path" },
            { value: "inspect", label: "Inspect sessions", hint: "read-only browse" },
            { value: "help", label: "Help", hint: "direct commands" },
            { value: "version", label: "Version" },
          ],
        }),
      );
      if (action === "relocate") {
        hadError = (await relocateFlow()) !== 0;
      } else if (action === "inspect") {
        await inspectFlow();
      } else if (action === "help") {
        printHelp();
      } else {
        writeOut(`${VERSION}\n`);
      }
      if (!process.stdin.isTTY) break;
    }
  } catch (err) {
    if (err instanceof FlowCancelled) {
      p.cancel("Cancelled — nothing was changed.");
      return 0;
    }
    if (err instanceof FlowError || err instanceof CliError) {
      p.log.error(err.message);
      hadError = true;
    } else {
      p.log.error(err instanceof Error ? err.message : String(err));
      hadError = true;
    }
  }
  p.outro(hadError ? "Finished with errors" : "Done");
  return hadError ? 1 : 0;
}
