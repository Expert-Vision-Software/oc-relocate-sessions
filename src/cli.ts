import { VERSION } from "./version.js";
import { CliError } from "./errors.js";
import type { DbCommandOptions } from "./options.js";
import { runDbs } from "./dbs.js";
import { runList } from "./list.js";

const HELP = `oc-relocate v${VERSION} — relocate opencode sessions when a repo changes location

Usage:
  oc-relocate                       Interactive menu (TTY)
  oc-relocate relocate --from <path> --to <path> [--apply]  Perform a relocation
  oc-relocate plan --from <path> --to <path>                Preview affected sessions
  oc-relocate list                                          List sessions in the resolved DB
  oc-relocate dbs                                           List Global DB candidates
  oc-relocate help                                          Show this help
  oc-relocate version                                       Show version

Flags:
  --db <path>   Target a specific Global DB file
  --json        Machine-readable output
  --apply, -y   Perform the write (default is a read-only plan)

Environment:
  OPENCODE_DB   Path to the Global DB (--db takes precedence)

Bare invocation without a TTY prints this help and exits 1.
`;

function printHelp(): void {
  process.stdout.write(HELP);
}

interface ParsedFlags {
  db?: string;
  json: boolean;
}

function parseFlags(args: readonly string[]): ParsedFlags {
  let db: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === "--json") {
      json = true;
    } else if (arg === "--db") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CliError("option --db requires a <path> value");
      }
      if (value.trim().length === 0) {
        throw new CliError("option --db requires a non-empty <path> value");
      }
      db = value;
      i++;
    } else if (arg.startsWith("--db=")) {
      const value = arg.slice("--db=".length);
      if (value.trim().length === 0) {
        throw new CliError("option --db requires a non-empty <path> value");
      }
      db = value;
    } else {
      throw new CliError(`unknown option: ${arg}`);
    }
  }
  return { db, json };
}

async function runDbCommand(command: "dbs" | "list", args: readonly string[]): Promise<number> {
  try {
    const parsed = parseFlags(args);
    if (command === "dbs") {
      return await runDbs({ json: parsed.json, dbFlag: parsed.db });
    }
    return await runList({ json: parsed.json, dbFlag: parsed.db });
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

  if (first === "dbs" || first === "list") {
    return runDbCommand(first, argv.slice(1));
  }

  process.stderr.write(`Unknown command: ${first}\n\n`);
  printHelp();
  return 1;
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
