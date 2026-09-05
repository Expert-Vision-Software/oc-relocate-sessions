# Contributing to oc-relocate

Thanks for your interest in contributing.

## Setup

Requirements: [Bun](https://bun.sh) >= 1.2 (blessed dev runtime), Node >= 24
for the npx path. No native dependencies.

```sh
bun install
```

## Development workflow

```sh
bun run build      # bundle src/cli.ts -> dist/cli.js (single file)
bun test           # full test suite (bun test)
bun run typecheck  # tsc --noEmit (strict, NodeNext)
```

Run a single test file while iterating:

```sh
bun test test/cli.test.ts
```

## Testing rules

- **One seam**: tests spawn the real CLI (`dist/cli.js`) and assert on stdout
  and on the resulting database state. Do not add internal seams or mock the
  SQLite layer.
- **Synthetic DBs only**: automated tests build a minimal schema in a temp
  directory via the factory in `test/helpers/synthetic-db.ts`. Never commit a
  copy of a real opencode database, and never point tests at your live DB.
- Both driver paths matter (`bun:sqlite` under Bun, `node:sqlite` under
  Node >= 24) — see `docs/adr/0001-sqlite-driver-strategy.md`.
- **Process guard is stubbed at the process boundary**: apply-path tests set
  `OC_RELOCATE_PROCESS_DETECTOR_OUTPUT` to fake the detector's input (its
  parsed output), so suites are hermetic even while opencode itself is
  running on the dev machine.
- **Interactive flows use scripted stdin**: `runCliInteractive` in
  `test/helpers/spawn-cli.ts` waits for each `@clack/prompts` render and then
  pipes the answer (`\r` submit, `y`/`n` confirm, `\x1b[B` down, `\x03` Ctrl-C).

## Domain vocabulary

`CONTEXT.md` at the repo root is the glossary. Use its terms (Relocation,
Plan, Apply, Session, Global DB, Channel) consistently in code, docs, and
CLI output. The ADRs under `docs/adr/` are binding for implementation
decisions.

## Submitting changes

1. Open or claim an issue describing the change.
2. Keep PRs focused; include tests through the CLI seam for behavior changes.
3. Update `CHANGELOG.md` for user-visible changes.

## License

By contributing, you agree that your contributions are licensed under the
MIT License.
