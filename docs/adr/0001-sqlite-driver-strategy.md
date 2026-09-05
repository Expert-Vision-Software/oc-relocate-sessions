# SQLite driver strategy: bun:sqlite first-class, Node ≥24 floor, no native deps

The utility must run under both `bunx` and `npx` without native build friction. We decided to use the runtime's built-in SQLite driver — `bun:sqlite` when running under Bun, `node:sqlite` under Node — and to set `engines.node >= 24` for the npx path, because `node:sqlite` is unflagged only on Node 24+ and `npx` cannot pass the `--experimental-sqlite` flag cleanly on Node 22. On older Node we print an actionable error pointing at `bunx oc-relocate`. We rejected `better-sqlite3` (native compilation) and a self-respawn-with-flag approach (fragile) — for a utility this small, zero dependencies outweigh maximum Node compatibility.

## Consequences

- Bun is the blessed runtime on machines pinned to Node 22 (including the maintainer's).
- CI and local dev test both driver paths.
