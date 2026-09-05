# Relocation rewrites session.directory only; snapshot orphans and transcript paths are accepted losses

Relocation's mandatory fix is exactly one column: `session.directory` (plus subdirectory matches via prefix REPLACE). We deliberately do **not** repair snapshot/revert data — keyed by a hash of the old worktree path under the project ID, unreachable after a move — and we do not rewrite historical path strings inside chat transcripts. We also leave `session.path` (project-relative) untouched. Optional tidy-up of `project.worktree`, `project.sandboxes`, `project_directory.directory`, `workspace.directory` exists behind a flag, off by default, because opencode self-heals those rows on next open at the new path.

Rationale: making snapshots and transcripts relocatable would require reimplementing opencode's internal hashing and mutating prose — high complexity, low value — while the accepted losses are invisible to the core use case (continuing sessions at the new path).

## Consequences

- Snapshot/revert history cannot be restored for relocated sessions; users lose revert capability for pre-move sessions.
- Old messages still display the old absolute paths; agents reading transcripts may see stale paths.
