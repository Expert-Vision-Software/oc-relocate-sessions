# oc-relocate

A CLI utility that relocates opencode coding-agent sessions when a git repository's local path changes, so session history follows the repo to its new location.

## Language

### Core

**Relocation**:
Rewriting where opencode believes a repo's sessions ran, after the repo's local path changes. One underlying operation for both a moved/renamed repo and a fresh clone pulling history from an old checkout.
_Avoid_: migration (implies schema or format change), move (ambiguous with ordinary file moves)

**Session**:
One recorded opencode conversation, stored in the Global DB and stamped with the directory it ran in.
_Avoid_: chat, thread

**Session directory**:
The absolute recorded path a Session ran in — the only value a Relocation rewrites. Sessions started in subdirectories of the old path are included.
_Avoid_: cwd, project path

**Session path**:
A project-relative location stored per Session; never rewritten by any Relocation.
_Avoid_: relative path

**Global DB**:
The single shared SQLite database where opencode stores all Sessions across every repo. One DB per install Channel.
_Avoid_: session store, storage

**Channel**:
The opencode install variant (stable, beta, …) that determines the Global DB filename (`opencode.db` vs `opencode-<channel>.db`).

**Remote-derived identity**:
Project identity comes from a hash of the git remote URL, not the local path — which is why Relocation never touches project linkage, only recorded directories.

### Operation

**Plan**:
A read-only preview of exactly which Sessions a Relocation would change, with counts grouped by directory. The default behavior.
_Avoid_: dry run

**Apply**:
The guarded write step that performs a Relocation, requiring an explicit opt-in flag and preceded by Backup and guards.

**Backup**:
A timestamped copy of the Global DB made immediately before any Apply.

**Process guard**:
Refusal to Apply while opencode processes are running, overridable only by an explicit force flag.

**WAL warning**:
A warning that recent opencode writes may still sit in the `-wal` sidecar, telling the user to quit opencode cleanly first so the Backup is complete.

**Tidy-up**:
An optional, off-by-default rewrite of project/workspace bookkeeping rows beyond Session directories; opencode self-heals these anyway, so it is cosmetic.

**Accepted losses**:
Relocation side effects deliberately not fixed: orphaned snapshot/revert data keyed to the old path, and historical path strings left as-is inside chat transcripts.

### Interfaces

**Args parity**:
Every action available in the interactive menu is also available as a direct command with flags, and vice versa.

**Command recommendation**:
After an interactive run completes, printing the exact direct command that reproduces it.

### Testing

**Synthetic DB**:
A minimal test database built programmatically in a temp dir; the only fixture used in automated tests.

**DB clone**:
A file copy of a real Global DB used strictly for read-only smoke checks (Plan, listing) — never written.

**Live DB**:
The user's real Global DB. Only the user ever Applies against it.
