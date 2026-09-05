# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Global DB resolution with the documented precedence: `--db` flag → `OPENCODE_DB` env → newest `opencode.db` / `opencode-<channel>.db` match under the platform data dir (newest by mtime wins).
- No-create guard: missing databases produce a clear error; the SQLite driver is never allowed to create a file. `OPENCODE_DB=:memory:` (and `--db :memory:`) is rejected with an explanatory message.
- Driver adapter (ADR-0001): `bun:sqlite` under Bun, `node:sqlite` under Node >= 24, both behind one thin read-only interface. Node < 24 gets an actionable error pointing at `bunx`.
- WAL warning: non-fatal stderr warning when the `-wal` sidecar of the resolved DB is >= 1 MiB.
- `dbs` subcommand: discovered DB candidates with path, channel, mtime, size and WAL size; the resolved default is marked; `--json` supported.
- `list` subcommand: read-only listing of projects/sessions in the resolved DB with counts grouped by directory; `--json` supported.
- `plan` subcommand: read-only Relocation preview — affected session rows and per-directory counts for `--from`/`--to`; `--json` supported. Path normalization (absolutize, backslashes → forward slashes, strip trailing slash) with `from === to` refused and a non-fatal warning when `--to` does not exist on disk. Optional `--also-project-tables` (default OFF) extends the preview with the project/workspace rows a Tidy-up would rewrite. Plan output never writes anything.

## [0.5.0] - 2026-09-05

### Added

- Initial scaffolding: TypeScript + Bun project skeleton with zero native dependencies.
- `oc-relocate` and `oc-relocate-sessions` bin entries backed by a single-file `dist/cli.js` build.
- Placeholder CLI responding to `--help`, `--version`, and the non-TTY no-args grammar.
- Test seam: CLI process-boundary spawn helper plus a temp-dir Synthetic DB factory (`session`, `project`, `project_directory`, `workspace`), the only fixtures used by automated tests.
- Release groundwork: package metadata, MIT license, contributing/security guides.
