# Security Policy

## Supported versions

Only the latest published version of `oc-relocate` receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately to:

**Expert Vision Software — <support@expertvision.software>**

Include a description of the issue, the steps to reproduce it, and the
affected version. You will receive an acknowledgement; please do not open a
public issue for anything you believe is exploitable.

## Scope notes

- `oc-relocate` reads and, only on explicit `--apply`/`-y`, writes the local
  opencode SQLite Global DB. Reports involving unexpected writes to that DB
  (in particular, writes without an explicit opt-in flag, or a missing or
  failed pre-write backup) are high priority.
- The tool never sends session data anywhere: no telemetry, no network
  requests beyond package installation itself.
- Relocation deliberately does not repair snapshot/revert data or rewrite
  transcript contents — see `docs/adr/0002-session-directory-only-rewrite-accepted-losses.md`.
  Behavior falling within those accepted losses is not a vulnerability.
