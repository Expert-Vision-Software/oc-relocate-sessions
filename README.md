# oc-relocate

**Move opencode agent sessions when your repo changes location.**

`oc-relocate` is a small CLI that relocates opencode sessions after a repository's
local path changes — so your opencode history follows the repo instead of
disappearing. It rewrites the recorded session directories in opencode's SQLite
database from the old path to the new path, with a read-only plan, an automatic
backup, and guards against writing while opencode is running.

Works identically on Windows, macOS, Linux, and WSL. No native dependencies.

```sh
bunx oc-relocate
```

That opens the interactive menu. Prefer direct commands? Every menu action has a
flag equivalent — see [Quickstart](#quickstart).

## Why you need this

opencode records each session with the absolute directory it ran in, in one
Global DB — a single SQLite database shared across every repo. When that path
stops being true — the folder was **moved or renamed**, or you made a **fresh
clone at a new location** — every session from the old path stops appearing in
opencode, because opencode matches sessions by recorded directory.

Your history is not gone. It is pointed at a path that no longer exists.

`oc-relocate` performs a **relocation**: it updates the recorded directories in
the opencode SQLite database from the old path to the new path, in one operation
that covers both scenarios:

- **Repo moved/renamed locally** — relocate sessions from the old path to the new one.
- **Fresh clone at a new path** — pull history from the old checkout location.

Whether you want to move opencode sessions after renaming a folder, or
relocate opencode sessions into a fresh clone at a new path, it is the same
one-command fix.

Sessions started in subdirectories of the old path are included, so nothing is
left behind. Project linkage is untouched (opencode identifies projects by git
remote URL, not local path), so the relocation is safe to repeat and reversible
with the backup it creates.

## Quickstart

### Interactive (recommended)

```sh
bunx oc-relocate
```

The menu walks you through: pick the database, pick/type the old path, pick/type
the new path, review a live plan preview, confirm, and apply. When it finishes
it prints the exact equivalent direct command, so you can graduate to direct
mode naturally.

### Direct mode

Preview what a relocation would change (read-only, the default):

```sh
bunx oc-relocate plan --from C:\code\webshop --to C:\dev\webshop
```

```sh
bunx oc-relocate plan --from /home/me/code/webshop --to /home/me/dev/webshop
```

Perform the relocation (adds backup + guards + the write):

```sh
bunx oc-relocate relocate --from C:\code\webshop --to C:\dev\webshop --apply
```

```sh
bunx oc-relocate relocate --from /home/me/code/webshop --to /home/me/dev/webshop --apply
```

> Nothing is written unless you pass `--apply` (or `-y`). A bare `plan` or
> `relocate` without `--apply` only previews.

### Scripting / CI

Every subcommand supports `--json` for machine-readable output:

```sh
bunx oc-relocate plan --from C:\code\webshop --to C:\dev\webshop --json
```

Inspect what is in the resolved database:

```sh
bunx oc-relocate list
```

List the Global DB candidates on this machine:

```sh
bunx oc-relocate dbs
```

## Requirements: Bun or Node ≥ 24

The tool reads SQLite through the runtime's built-in driver: `bun:sqlite` under
Bun, `node:sqlite` under Node. `node:sqlite` is only stable (unflagged) on
Node 24+, so:

- **Bun**: `bunx oc-relocate` — zero setup, any recent Bun.
- **Node**: `npx oc-relocate` — requires Node ≥ 24.

On older Node you get an actionable error, not a cryptic driver failure:

```text
error: oc-relocate needs Node >= 24 for the built-in SQLite driver (found v22.5.1). Run with Bun instead: bunx oc-relocate
```

If you are pinned to an older Node, use `bunx`. See
[ADR-0001](docs/adr/0001-sqlite-driver-strategy.md) for the reasoning.

## Cross-platform notes

Behavior is identical on Windows, macOS, Linux, and WSL — same flags, same
output, same guards. Only the example paths differ.

- **Windows (PowerShell)**: flags and plain paths just work — no quoting
  gymnastics. Where a path contains spaces, wrap it in single quotes:
  `bunx oc-relocate plan --from 'C:\my repos\webshop' --to 'C:\code\webshop'`
- **macOS / Linux (bash, zsh)**: paths with spaces work fine in single quotes
  too: `bunx oc-relocate plan --from '/home/me/my repos/webshop' --to '/home/me/code/webshop'`
- **WSL**: opencode stores its database under the Linux filesystem when it runs
  inside WSL, and under the Windows user profile when it runs on Windows. Run
  `bunx oc-relocate dbs` in the same environment where opencode runs to see
  which databases are visible from there. WSL can read the Windows database via
  the `--db` flag (e.g. `--db /mnt/c/Users/<you>/.local/share/opencode/opencode.db`).

Throughout this README, commands are shown once with a Windows path and once
with a POSIX path — use the variant that matches your shell. The flags
themselves are plain and identical everywhere; only the path style differs.

## Safety story

oc-relocate is designed so a first-time user cannot damage anything:

- **Plan by default.** Without `--apply`, nothing is written — ever. The plan
  shows exactly which session rows would change, grouped by directory.
- **Backup.** Before any apply, the tool copies the database to a timestamped
  sibling: `<db>.bak-relocate-<ISO timestamp>`. Restore is a file copy back.
- **Process guard.** If opencode appears to be running, apply refuses, so
  concurrent writes cannot corrupt the database. False positive? `--force`
  overrides it, at your own risk.
- **WAL warning.** If the database has a large `-wal` sidecar, recent opencode
  writes may still sit in it and the backup could miss them. The tool warns and
  suggests quitting opencode cleanly first.
- **No-create guarantee.** If no database is found, the tool errors clearly. It
  never lets the SQLite driver create an empty database, so a missing file can
  never masquerade as "you have no sessions".

A typical successful apply looks like:

```text
Global DB: C:\Users\me\.local\share\opencode\opencode.db
Backup: C:\Users\me\.local\share\opencode\opencode.db.bak-relocate-2026-09-06T12-00-00.000Z
Relocated 4 sessions from C:\code\webshop to C:\dev\webshop

Sessions by directory (after relocation):
  3  C:\dev\webshop
  1  C:\dev\webshop\packages\api

Verified: 4 of 4 planned session changes applied.
```

The apply runs inside a single transaction: any mid-flight failure rolls back
completely, and the backup path is printed so you can restore.

## Databases and channels

opencode keeps **one global database per install channel** in the platform data
dir:

| Platform        | Location                                        |
| --------------- | ----------------------------------------------- |
| Windows         | `%USERPROFILE%\.local\share\opencode\`          |
| macOS / Linux   | `~/.local/share/opencode/`                      |
| WSL (opencode in WSL) | `~/.local/share/opencode/` inside the WSL distro |

Filenames: `opencode.db` for the stable channel, `opencode-<channel>.db` for
others (e.g. `opencode-beta.db`).

Resolution order, first match wins:

1. `--db <path>` flag
2. `OPENCODE_DB` environment variable
3. newest `opencode*.db` match in the data dir (by modification time)

`bunx oc-relocate dbs` shows every candidate with channel, mtime, size, and WAL
size, and marks the resolved default. Multiple opencode installs? Resolve with
`--db` (or `OPENCODE_DB`) and target any specific file. `:memory:` is rejected
with an explanation — the tool only ever opens a real file.

## What a relocation changes — and what it doesn't

The rewrite touches exactly one thing: `session.directory` (the absolute path
each session ran in), including subdirectory matches under the old path.

Deliberately **not** fixed (accepted losses, see
[ADR-0002](docs/adr/0002-session-directory-only-rewrite-accepted-losses.md)):

- **Snapshot/revert data** stays keyed to the old path and becomes orphaned —
  revert capability for pre-move sessions is lost.
- **Historical path strings inside transcripts** are left as-is. Old messages
  still display old absolute paths; agents reading a transcript may see stale
  paths.

`session.path` (project-relative) and `project_id` (remote-derived identity)
are never modified.

An opt-in tidy-up, `--also-project-tables` (off by default), additionally
rewrites project/workspace bookkeeping rows (`project.worktree`,
`project.sandboxes`, `project_directory.directory`, `workspace.directory`).
opencode self-heals these on next open anyway, so this is cosmetic.

## CLI reference

```text
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
```

Exit codes: `0` on success, `1` on any error (missing database, refused guard,
bad arguments, non-TTY bare invocation).

## FAQ

**Is my session history deleted?**
No. A relocation rewrites path strings in the database; nothing is deleted. A
timestamped backup is made before every apply, and a plan never writes at all.

**I renamed my repo folder. Which scenario is mine?**
Both scenarios are the same operation. Moved/renamed folder: relocate from the
old path to the new one. Fresh clone at a new location: same — `--from` the old
checkout path, `--to` the new one, and the history follows.

**Does this work with the opencode "move session" feature?**
opencode's built-in per-session move is a different niche: one session at a
time, and the destination must already be a registered project directory.
oc-relocate does the bulk fix for a path change, including subdirectory
sessions and full history beyond the TUI's 30-day window.

**Is it safe to run while opencode is open?**
Planning and listing are read-only and safe. Applying is refused while opencode
appears to be running — quit opencode first, then apply. `--force` exists for
false positives, but concurrent writes during an apply can corrupt the database.

**Which database will it touch?**
Run `bunx oc-relocate dbs` to see every candidate and which one resolves by
default. Pin it explicitly with `--db <path>` or the `OPENCODE_DB` environment
variable if you have multiple installs or channels.

**npx or bunx?**
Both work. `bunx oc-relocate` anywhere; `npx oc-relocate` on Node ≥ 24 (the
built-in SQLite driver needs Node 24+; older Node gets an error pointing you at
`bunx`).

**Can I undo a relocation?**
Yes — quit opencode, then copy the printed backup file
(`<db>.bak-relocate-<timestamp>`) back over the database file.

**Will old messages inside a session show the new path?**
No. Transcript text is never rewritten (an accepted loss). Sessions appear and
continue at the new path, but historical messages keep their original absolute
paths.

## Development

```sh
bun install
bun test           # full suite (synthetic databases only, never your real one)
bun run typecheck
bun run build      # bundle src/cli.ts -> dist/cli.js
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the testing rules and release flow.

## License

[MIT](LICENSE)
