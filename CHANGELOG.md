# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Release automation (`.github/workflows/publish.yml`): `v*` tag push triggers the CI matrix (the test suite under both `bun:sqlite` and `node:sqlite` via `OC_RELOCATE_TEST_RUNTIME`), an npm version-duplicate check, a provenance publish, and a GitHub Release; prerelease-style tags (e.g. `v0.5.0-rc.1`) run the release path with `npm publish --dry-run` so the path can be proven without publishing; manual dispatch validates CI only by default. `CONTRIBUTING.md` documents the `NPM_TOKEN` setup and release flow.
- `relocate` subcommand implementing the guarded Apply pipeline: validation → DB resolution → running-opencode process guard (`tasklist` / `pgrep`, overridable with `--force`) → timestamped backup (`<db>.bak-relocate-<ISO timestamp>`, byte-faithful) → transactional `BEGIN IMMEDIATE`/`COMMIT` prefix-scoped `REPLACE` rewrite → in-transaction verification (applied vs planned counts) → report grouped by directory. Read-only plan by default; `--apply`/`-y` performs the write. Optional `--also-project-tables` Tidy-up rewrites `project.worktree`, `project.sandboxes` (JSON array), `project_directory.directory` and `workspace.directory`. Any mid-pipeline failure rolls back completely and prints the backup path. `--json` supported.
- Interactive menu (`@clack/prompts`) on bare TTY invocation: **Relocate** (staged wizard — DB resolve/pick from discovery, old path seeded from `project_directory`/`project.worktree` rows with manual fallback, disk-probed new-path candidates, live Plan preview, explicit confirm gate, Backup → Apply → verify summary, Command recommendation printing the exact equivalent direct command), **Inspect** (read-only browse reusing `list`), **Help** and **Version**. Ctrl-C exits cleanly at any prompt; every menu action maps 1:1 to an existing subcommand (Args parity). Set `OC_RELOCATE_MENU=1` to open the menu without a TTY.
- Global DB resolution with the documented precedence: `--db` flag → `OPENCODE_DB` env → newest `opencode.db` / `opencode-<channel>.db` match under the platform data dir (newest by mtime wins).
- No-create guard: missing databases produce a clear error; the SQLite driver is never allowed to create a file. `OPENCODE_DB=:memory:` (and `--db :memory:`) is rejected with an explanatory message.
- Driver adapter (ADR-0001): `bun:sqlite` under Bun, `node:sqlite` under Node >= 24, both behind one thin read-only interface. Node < 24 gets an actionable error pointing at `bunx`.
- WAL warning: non-fatal stderr warning when the `-wal` sidecar of the resolved DB is >= 1 MiB.
- `dbs` subcommand: discovered DB candidates with path, channel, mtime, size and WAL size; the resolved default is marked; `--json` supported.
- `list` subcommand: read-only listing of projects/sessions in the resolved DB with counts grouped by directory; `--json` supported.
- `plan` subcommand: read-only Relocation preview — affected session rows and per-directory counts for `--from`/`--to`; `--json` supported. Path normalization (absolutize, backslashes → forward slashes, strip trailing slash) with `from === to` refused and a non-fatal warning when `--to` does not exist on disk. Optional `--also-project-tables` (default OFF) extends the preview with the project/workspace rows a Tidy-up would rewrite. Plan output never writes anything.

### Fixed

- Large `--json` reports piped to another process could arrive truncated on POSIX: the CLI now flushes stdout/stderr before exiting.

## [0.5.0] - 2026-09-05

### Added

- Initial scaffolding: TypeScript + Bun project skeleton with zero native dependencies.
- `oc-relocate` and `oc-relocate-sessions` bin entries backed by a single-file `dist/cli.js` build.
- Placeholder CLI responding to `--help`, `--version`, and the non-TTY no-args grammar.
- Test seam: CLI process-boundary spawn helper plus a temp-dir Synthetic DB factory (`session`, `project`, `project_directory`, `workspace`), the only fixtures used by automated tests.
- Release groundwork: package metadata, MIT license, contributing/security guides.
