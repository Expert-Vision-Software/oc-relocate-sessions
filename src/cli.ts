import { VERSION } from "./version.js";
import { CliError } from "./errors.js";
import type { DbCommandOptions, PlanCommandOptions } from "./options.js";
import { runDbs } from "./dbs.js";
import { runList } from "./list.js";
import { runPlan } from "./plan.js";

const HELP = `oc-relocate v${VERSION} — relocate opencode sessions when a repo changes location

Usage:
  oc-relocate                       Interactive menu (TTY)
  oc-relocate relocate --from <path> --to <path> [--apply]  Perform a relocation
  oc-relocate plan --from <path> --to <path> [--also-project-tables]
                                                            Preview affected sessions
  oc-relocate list                                          List sessions in the resolved DB
  oc-relocate dbs                                           List Global DB candidates
  oc-relocate help                                          Show this help
  oc-relocate version                                       Show version

Flags:
  --db <path>               Target a specific Global DB file
  --json                    Machine-readable output
  --apply, -y               Perform the write (default is a read-only plan)
  --also-project-tables     Include project/workspace rows in the plan (off by default)

Environment:
  OPENCODE_DB   Path to the Global DB (--db takes precedence)

Bare invocation without a TTY prints this help and exits 1.
`;

function printHelp(): void {
  process.stdout.write(HELP);
}

const BOOLEAN_FLAGS = new Set(["json", "also-project-tables"]);
const VALUE_FLAGS = new Set(["db", "from", "to"]);

interface ParsedFlags {
  db?: string;
  json: boolean;
  from?: string;
  to?: string;
  alsoProjectTables: boolean;
}

function parseFlags(args: readonly string[]): ParsedFlags {
  const parsed: ParsedFlags = { json: false, alsoProjectTables: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (!arg.startsWith("--") || arg === "--") {
      throw new CliError(`unknown option: ${arg}`);
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (BOOLEAN_FLAGS.has(name)) {
      if (eq !== -1) {
        throw new CliError(`option --${name} does not take a value`);
      }
      if (name === "json") parsed.json = true;
      else parsed.alsoProjectTables = true;
    } else if (VALUE_FLAGS.has(name)) {
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
      if (name === "db") parsed.db = value;
      else if (name === "from") parsed.from = value;
      else parsed.to = value;
    } else {
      throw new CliError(`unknown option: --${name}`);
    }
  }
  return parsed;
}

async function runCommand(command: "dbs" | "list" | "plan", args: readonly string[]): Promise<number> {
  try {
    const parsed = parseFlags(args);
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
    process.stderr.write(
      process.stdin.isTTY
        ? "Interactive menu is not implemented yet (planned for slice 5). Use --help for direct commands.\n\n"
        : "No arguments given; expected a subcommand.\n\n",
    );
    printHelp();
    return 1;
  }

  if (first === "dbs" || first === "list" || first === "plan") {
    return runCommand(first, argv.slice(1));
  }

  process.stderr.write(`Unknown command: ${first}\n\n`);
  printHelp();
  return 1;
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
