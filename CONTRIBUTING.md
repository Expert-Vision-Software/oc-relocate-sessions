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
  Node >= 24) — see `docs/adr/0001-sqlite-driver-strategy.md`. Locally, run
  the whole suite against the Node driver with
  `OC_RELOCATE_TEST_RUNTIME=node bun test` (needs Node >= 24 on PATH); the
  publish workflow's CI matrix runs exactly these two legs.
- **Process guard is stubbed at the process boundary**: apply-path tests set
  `OC_RELOCATE_PROCESS_DETECTOR_OUTPUT` to fake the detector's parsed output,
  or `OC_RELOCATE_PROCESS_DETECTOR_ERROR` to fake detector unavailability
  (the guard-was-skipped path), so suites are hermetic even while opencode
  itself is running on the dev machine.
- **Interactive flows use scripted stdin**: `runCliInteractive` in
  `test/helpers/spawn-cli.ts` waits for each `@clack/prompts` render and then
  pipes the answer (`\r` submit, `y`/`n` confirm, `\x1b[B` down, `\x03` Ctrl-C).

## Domain vocabulary

`CONTEXT.md` at the repo root is the glossary. Use its terms (Relocation,
Plan, Apply, Session, Global DB, Channel) consistently in code, docs, and
CLI output. The ADRs under `docs/adr/` are binding for implementation
decisions.

## Releasing

`.github/workflows/publish.yml` automates publishing. Pushing a `v*` tag runs
the CI matrix (the same test suite under `bun:sqlite` and `node:sqlite` /
Node 24), checks npm for a duplicate version, builds, publishes with
`--provenance`, and creates the GitHub Release (notes from `CHANGELOG.md`,
no binary artifact).

### One-time setup (maintainer wizard)

1. Create an npm granular publish token at
   <https://www.npmjs.com/settings/YOUR-USER/tokens/granular-access-tokens/new> —
   package `oc-relocate`, permission "Read and write".
2. Add it as the repository secret `NPM_TOKEN`
   (Settings → Secrets and variables → Actions). Tokens expire — if a publish
   fails with 403/404, regenerate the token and re-paste the secret.
3. Check Settings → Actions → General → Workflow permissions is set to
   "Read and write permissions" (the release job needs it).

### Cutting a release

1. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md` (the workflow
   extracts the release notes from it and fails the run if it is missing).
2. Set `package.json` `version` to `X.Y.Z` and commit.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`.

The workflow guards a stable tag against `package.json` drift: if the tag
version and the `package.json` version differ, the run fails before publish.

### Proving the release path without publishing

Push a prerelease-style test tag (e.g. `v0.5.0-rc.1`): the full release path
runs, `npm publish` executes as `--dry-run` (nothing reaches the registry),
and a **prerelease** GitHub Release is created with commit-based notes. The
pack carries the tag version (`0.5.0-rc.1`), never the real one.

`Actions → Publish → Run workflow` is validation-only by default (`dry_run`
on): CI matrix and version checks run, publish and release are skipped.

### If a release fails

```sh
gh release delete vX.Y.Z --yes
git push origin :refs/tags/vX.Y.Z
git tag -d vX.Y.Z
# fix the cause, then re-create and push the tag
```

If the version actually made it to npm, bump the version instead of
re-publishing — the workflow's duplicate check (`npm view`) skips
already-published versions so re-runs stay green.

## Submitting changes

1. Open or claim an issue describing the change.
2. Keep PRs focused; include tests through the CLI seam for behavior changes.
3. Update `CHANGELOG.md` for user-visible changes.

## License

By contributing, you agree that your contributions are licensed under the
MIT License.
