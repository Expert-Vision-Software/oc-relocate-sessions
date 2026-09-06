import { VERSION } from "./version.js";
import { writeOut } from "./output.js";

export const HELP = `oc-relocate v${VERSION} — relocate opencode sessions when a repo changes location

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
  --force                   Override the running-opencode process guard
  --also-project-tables     Include project/workspace rows in the rewrite (off by default)

Environment:
  OPENCODE_DB           Path to the Global DB (--db takes precedence)
  OC_RELOCATE_MENU=1    Open the interactive menu even when stdin is not a TTY

Bare invocation without a TTY prints this help and exits 1.
`;

export function printHelp(): void {
  writeOut(HELP);
}
