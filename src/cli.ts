import { VERSION } from "./version.js";
import { CliError } from "./errors.js";
import type { DbCommandOptions, PlanCommandOptions, RelocateCommandOptions } from "./options.js";
import { runDbs } from "./dbs.js";
import { runList } from "./list.js";
import { runPlan } from "./plan.js";
import { runRelocate } from "./relocate.js";
import { printHelp } from "./help.js";

const BOOLEAN_FLAG_FIELDS = {
  json: "json",
  "also-project-tables": "alsoProjectTables",
  apply: "apply",
  force: "force",
} as const;
const VALUE_FLAG_FIELDS = { db: "db", from: "from", to: "to" } as const;

type BooleanFlagName = keyof typeof BOOLEAN_FLAG_FIELDS;
type ValueFlagName = keyof typeof VALUE_FLAG_FIELDS;

interface ParsedFlags {
  db?: string;
  json: boolean;
  from?: string;
  to?: string;
  alsoProjectTables: boolean;
  apply: boolean;
  force: boolean;
}

function parseFlags(args: readonly string[]): ParsedFlags {
  const parsed: ParsedFlags = {
    json: false,
    alsoProjectTables: false,
    apply: false,
    force: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === "-y") {
      parsed.apply = true;
      continue;
    }
    if (!arg.startsWith("--") || arg === "--") {
      throw new CliError(`unknown option: ${arg}`);
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (isBooleanFlag(name)) {
      if (eq !== -1) {
        throw new CliError(`option --${name} does not take a value`);
      }
      parsed[BOOLEAN_FLAG_FIELDS[name]] = true;
    } else if (isValueFlag(name)) {
      let value: string | undefined;
      if (eq === -1) {
        value = args[i + 1];
        i++;
      } else {
        value = arg.slice(eq + 1);
      }
      if (value === undefined || value.startsWith("--")) {
        throw new CliError(`option --${name} requires a <path> value`);
      }
      if (value.trim().length === 0) {
        throw new CliError(`option --${name} requires a non-empty <path> value`);
      }
      parsed[VALUE_FLAG_FIELDS[name]] = value;
    } else {
      throw new CliError(`unknown option: --${name}`);
    }
  }
  return parsed;
}

function isBooleanFlag(name: string): name is BooleanFlagName {
  return name in BOOLEAN_FLAG_FIELDS;
}

function isValueFlag(name: string): name is ValueFlagName {
  return name in VALUE_FLAG_FIELDS;
}

async function runCommand(
  command: "dbs" | "list" | "plan" | "relocate",
  args: readonly string[],
): Promise<number> {
  try {
    const parsed = parseFlags(args);
    if (command !== "relocate" && (parsed.apply || parsed.force)) {
      throw new CliError(
        `${command} is read-only and does not accept ${parsed.apply ? "--apply" : "--force"} — ` +
          `use 'relocate' to perform a write`,
      );
    }
    if (command === "dbs") {
      return await runDbs({ json: parsed.json, dbFlag: parsed.db } satisfies DbCommandOptions);
    }
    if (command === "plan") {
      if (parsed.from === undefined) {
        throw new CliError("plan requires --from <path> — the old repo path");
      }
      if (parsed.to === undefined) {
        throw new CliError("plan requires --to <path> — the new repo path");
      }
      const planOptions: PlanCommandOptions = {
        json: parsed.json,
        dbFlag: parsed.db,
        from: parsed.from,
        to: parsed.to,
        alsoProjectTables: parsed.alsoProjectTables,
      };
      return await runPlan(planOptions);
    }
    if (command === "relocate") {
      if (parsed.from === undefined) {
        throw new CliError("relocate requires --from <path> — the old repo path");
      }
      if (parsed.to === undefined) {
        throw new CliError("relocate requires --to <path> — the new repo path");
      }
      const relocateOptions: RelocateCommandOptions = {
        json: parsed.json,
        dbFlag: parsed.db,
        from: parsed.from,
        to: parsed.to,
        alsoProjectTables: parsed.alsoProjectTables,
        apply: parsed.apply,
        force: parsed.force,
      };
      return await runRelocate(relocateOptions);
    }
    return await runList({ json: parsed.json, dbFlag: parsed.db } satisfies DbCommandOptions);
  } catch (err) {
    if (!(err instanceof CliError)) {
      process.stderr.write(
        `error: failed to read the Global DB (${err instanceof Error ? err.message : String(err)})\n`,
      );
      return 1;
    }
    process.stderr.write(`error: ${err.message}\n`);
    return 1;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const first = argv[0];

  if (first === "--help" || first === "-h" || first === "help") {
    printHelp();
    return 0;
  }

  if (first === "--version" || first === "-v" || first === "version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (first === undefined) {
    const menuRequested = process.env.OC_RELOCATE_MENU;
    const menuForced = menuRequested !== undefined && menuRequested !== "" && menuRequested !== "0";
    if (process.stdin.isTTY || menuForced) {
      const { runMenu } = await import("./menu.js");
      return runMenu();
    }
    process.stderr.write("No arguments given; expected a subcommand.\n\n");
    printHelp();
    return 1;
  }

  if (first === "dbs" || first === "list" || first === "plan" || first === "relocate") {
    return runCommand(first, argv.slice(1));
  }

  process.stderr.write(`Unknown command: ${first}\n\n`);
  printHelp();
  return 1;
}

function drain(stream: { write: (chunk: string, cb?: () => void) => unknown }): Promise<void> {
  return new Promise((resolve) => {
    stream.write("", () => resolve());
  });
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2));
  // Streams queue writes in order, so these callbacks fire only after every
  // earlier chunk reached the OS. Without this, a large --json report piped
  // to another process can be truncated when process.exit cuts the loop.
  await Promise.all([drain(process.stdout), drain(process.stderr)]);
  process.exit(code);
}
