import { VERSION } from "./version.js";

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

Bare invocation without a TTY prints this help and exits 1.
`;

function printHelp(): void {
  process.stdout.write(HELP);
}

export function main(argv: readonly string[]): number {
  const first = argv[0];

  if (first === "--help" || first === "-h" || first === "help") {
    printHelp();
    return 0;
  }

  if (first === "--version" || first === "-v" || first === "version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (first === undefined && !process.stdin.isTTY) {
    printHelp();
    return 1;
  }

  process.stderr.write(`Unknown command: ${first ?? "(none)"}\n\n`);
  printHelp();
  return 1;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
