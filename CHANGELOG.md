# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-09-05

### Added

- Initial scaffolding: TypeScript + Bun project skeleton with zero native dependencies.
- `oc-relocate` and `oc-relocate-sessions` bin entries backed by a single-file `dist/cli.js` build.
- Placeholder CLI responding to `--help`, `--version`, and the non-TTY no-args grammar.
- Test seam: CLI process-boundary spawn helper plus a temp-dir Synthetic DB factory (`session`, `project`, `project_directory`, `workspace`), the only fixtures used by automated tests.
- Release groundwork: package metadata, MIT license, contributing/security guides.
