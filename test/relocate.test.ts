import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { runCli } from "./helpers/spawn-cli.js";
import { createSyntheticDb, type SyntheticDb } from "./helpers/synthetic-db.js";
import { createFakeHome } from "./helpers/data-dir.js";
import { backupFiles, queryRows, sessionRows } from "./helpers/db-inspect.js";
import { nodeMajorVersion } from "./helpers/node-version.js";

const fwd = (value: string): string => value.replaceAll("\\", "/");
const native = (value: string): string => (sep === "\\" ? value.replaceAll("/", "\\") : value);
const joined = (base: string, ...parts: string[]): string => fwd(join(base, ...parts));

const DETECTOR_ENV = "OC_RELOCATE_PROCESS_DETECTOR_OUTPUT";
const DETECTOR_ERROR_ENV = "OC_RELOCATE_PROCESS_DETECTOR_ERROR";

interface RelocateJson {
  db: string;
  from: string;
  to: string;
  toExists: boolean;
  changed: boolean;
  backup?: string;
  force?: boolean;
  planned?: { sessions: number; directories: number };
  changes?: { session: number; projectWorktree?: number; projectSandboxes?: number; projectDirectory?: number; workspace?: number };
  verify?: { applied: number; planned: number };
  directories?: { directory: string; sessions: number }[];
  totals?: { sessions: number; directories: number };
  sessions?: { id: string; projectId: string; directory: string; path: string }[];
}

function dbBytes(dbPath: string): Buffer {
  return readFileSync(dbPath);
}

function seedStandardDb(): ReturnType<typeof createSyntheticDb> {
  const db = createSyntheticDb();
  db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
  db.insertSession({ id: "s2", projectId: "p1", directory: "C:/dev/foo" });
  db.insertSession({ id: "s3", projectId: "p1", directory: "C:/dev/foo/sub" });
  db.insertSession({ id: "s4", projectId: "p2", directory: "C:/dev/unrelated" });
  return db;
}

const NO_PROCESSES = "INFO: No tasks are running which match the specified criteria.";

function applyEnv(fakeHome: { env: Record<string, string> }, detectorOutput: string = NO_PROCESSES): Record<string, string> {
  return { ...fakeHome.env, [DETECTOR_ENV]: detectorOutput };
}

describe("relocate without --apply (read-only by default)", () => {
  test("prints the plan, changes nothing, creates no backup", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const before = dbBytes(db.dbPath);
    const { exitCode, stdout } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Affected sessions: 3");
    expect(stdout).toMatch(/no changes were made/i);
    expect(stdout).toMatch(/--apply/i);
    expect(dbBytes(db.dbPath).equals(before)).toBe(true);
    expect(backupFiles(db.dir)).toEqual([]);
  });

  test("--json matches the plan shape with changed: false", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const { exitCode, stdout } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--json"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as RelocateJson;
    expect(parsed.changed).toBe(false);
    expect(parsed.totals).toEqual({ sessions: 3, directories: 2 });
    expect(parsed.sessions?.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect("backup" in parsed).toBe(false);
  });

  test("the process guard does not run on the read-only path", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const { exitCode } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar"],
      { env: { ...fakeHome.env, [DETECTOR_ENV]: "4242" } },
    );

    expect(exitCode).toBe(0);
  });
});

describe("relocate --apply writes the Global DB", () => {
  test("rewrites session directories including subdirectory sessions", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const { exitCode, stdout, stderr } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply"],
      { env: applyEnv(fakeHome) },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/does not exist on disk/);
    expect(stdout).toContain("Relocated 3 sessions");
    expect(stdout).toContain(native("C:/dev/bar"));
    const rows = sessionRows(db.dbPath);
    expect(rows).toEqual([
      { id: "s1", directory: "C:/dev/bar" },
      { id: "s2", directory: "C:/dev/bar" },
      { id: "s3", directory: "C:/dev/bar/sub" },
      { id: "s4", directory: "C:/dev/unrelated" },
    ]);
  });

  test("creates a byte-faithful backup before writing", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const before = dbBytes(db.dbPath);
    const { exitCode, stdout } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply"],
      { env: applyEnv(fakeHome) },
    );

    expect(exitCode).toBe(0);
    const backups = backupFiles(db.dir);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/\.bak-relocate-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    expect(dbBytes(join(db.dir, backups[0]!)).equals(before)).toBe(true);
    expect(stdout).toContain(backups[0]!);
  });

  test("keeps tidy-up tables untouched by default", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertProject({ id: "p1", worktree: "C:/dev/foo", sandboxes: JSON.stringify(["C:/dev/foo/x"]) });
    db.insertProjectDirectory({ id: "pd1", projectId: "p1", directory: "C:/dev/foo" });
    db.insertWorkspace({ id: "w1", directory: "C:/dev/foo" });
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    db.close();

    const { exitCode } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply"],
      { env: applyEnv(fakeHome) },
    );

    expect(exitCode).toBe(0);
    expect(queryRows(db.dbPath, "SELECT worktree, sandboxes FROM project WHERE id = 'p1'")).toEqual([
      { worktree: "C:/dev/foo", sandboxes: '["C:/dev/foo/x"]' },
    ]);
    expect(queryRows(db.dbPath, "SELECT directory FROM project_directory WHERE id = 'pd1'")).toEqual([
      { directory: "C:/dev/foo" },
    ]);
    expect(queryRows(db.dbPath, "SELECT directory FROM workspace WHERE id = 'w1'")).toEqual([
      { directory: "C:/dev/foo" },
    ]);
  });

  test("--also-project-tables rewrites worktree, sandboxes, project_directory and workspace", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertProject({ id: "p1", worktree: "C:/dev/foo", sandboxes: JSON.stringify(["C:/dev/foo/x", "C:/else"]) });
    db.insertProjectDirectory({ id: "pd1", projectId: "p1", directory: "C:/dev/foo" });
    db.insertWorkspace({ id: "w1", directory: "C:/dev/foo" });
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    db.close();

    const { exitCode } = await runCli(
      [
        "relocate",
        "--db",
        db.dbPath,
        "--from",
        "C:/dev/foo",
        "--to",
        "C:/dev/bar",
        "--also-project-tables",
        "--apply",
        "--json",
      ],
      { env: applyEnv(fakeHome) },
    );

    expect(exitCode).toBe(0);
    expect(queryRows(db.dbPath, "SELECT worktree, sandboxes FROM project WHERE id = 'p1'")).toEqual([
      { worktree: "C:/dev/bar", sandboxes: '["C:/dev/bar/x","C:/else"]' },
    ]);
    expect(queryRows(db.dbPath, "SELECT directory FROM project_directory WHERE id = 'pd1'")).toEqual([
      { directory: "C:/dev/bar" },
    ]);
    expect(queryRows(db.dbPath, "SELECT directory FROM workspace WHERE id = 'w1'")).toEqual([
      { directory: "C:/dev/bar" },
    ]);
  });

  test("-y is an alias for --apply", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const { exitCode } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "-y"],
      { env: applyEnv(fakeHome) },
    );

    expect(exitCode).toBe(0);
    expect(sessionRows(db.dbPath)[0]?.directory).toBe("C:/dev/bar");
  });
});

describe("relocate reporting", () => {
  test("--json reports planned vs actual changes and the backup path", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const { exitCode, stdout } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply", "--json"],
      { env: applyEnv(fakeHome) },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as RelocateJson;
    expect(parsed.changed).toBe(true);
    expect(parsed.from).toBe("C:/dev/foo");
    expect(parsed.to).toBe("C:/dev/bar");
    expect(parsed.backup).toMatch(/\.bak-relocate-/);
    expect(parsed.planned).toEqual({ sessions: 3, directories: 2 });
    expect(parsed.changes).toEqual({ session: 3 });
    expect(parsed.verify).toEqual({ applied: 3, planned: 3 });
    expect(parsed.directories).toEqual([
      { directory: "C:/dev/bar", sessions: 2 },
      { directory: "C:/dev/bar/sub", sessions: 1 },
    ]);
  });

  test("no-op apply with zero matching sessions creates no backup and reports it", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const { exitCode, stdout } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/nowhere", "--to", "C:/dev/bar", "--apply"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/no sessions|nothing to relocate/i);
    expect(backupFiles(db.dir)).toEqual([]);
  });

  test("advises about the WAL sidecar on apply when one exists", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();
    const walPath = `${db.dbPath}-wal`;
    (await import("node:fs")).writeFileSync(walPath, "wal-bytes");

    const { exitCode, stderr } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply"],
      { env: applyEnv(fakeHome) },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/WAL/i);
    expect(stderr).toMatch(/quit opencode/i);
  });
});

describe("relocate process guard", () => {
  test("refuses to apply while opencode appears to be running", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const before = dbBytes(db.dbPath);
    const { exitCode, stderr } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply"],
      { env: { ...fakeHome.env, [DETECTOR_ENV]: "4242\n4243" } },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/opencode appears to be running/i);
    expect(stderr).toMatch(/--force/);
    expect(dbBytes(db.dbPath).equals(before)).toBe(true);
    expect(backupFiles(db.dir)).toEqual([]);
  });

  test("refuses on a fake Windows detector row too", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const { exitCode, stderr } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply"],
      { env: { ...fakeHome.env, [DETECTOR_ENV]: '"opencode.exe","4242","Console","1","12,345 K"' } },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/opencode appears to be running/i);
  });

  test("detector output without opencode does not block the apply", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const { exitCode } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply"],
      {
        env: {
          ...fakeHome.env,
          [DETECTOR_ENV]: 'INFO: No tasks are running which match the specified criteria.',
        },
      },
    );

    expect(exitCode).toBe(0);
  });

  test("an unavailable detector warns that the guard was skipped and still applies", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const { exitCode, stderr } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply"],
      { env: { ...applyEnv(fakeHome), [DETECTOR_ERROR_ENV]: "spawn pgrep ENOENT" } },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/spawn pgrep ENOENT/);
    expect(stderr).toMatch(/process guard was skipped/);
    expect(sessionRows(db.dbPath)[0]?.directory).toBe("C:/dev/bar");
  });

  test("--force overrides the guard with a warning and applies", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const { exitCode, stdout, stderr } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply", "--force"],
      { env: { ...fakeHome.env, [DETECTOR_ENV]: "4242" } },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/--force/i);
    expect(stdout).toContain("Relocated 3 sessions");
    expect(sessionRows(db.dbPath)[2]?.directory).toBe("C:/dev/bar/sub");
  });

  test("guard refusal leaves the JSON result untouched on stdout only for success", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const { exitCode, stdout } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply", "--json"],
      { env: { ...fakeHome.env, [DETECTOR_ENV]: "4242" } },
    );

    expect(exitCode).toBe(1);
    expect(stdout).not.toMatch(/"changed": true/);
  });
});

describe("relocate failure behavior", () => {
  test("rolls back completely when the write fails mid-transaction", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.exec(
      "CREATE TRIGGER fail_apply BEFORE UPDATE ON session BEGIN SELECT RAISE(ABORT, 'induced failure'); END;",
    );
    db.close();

    const before = dbBytes(db.dbPath);
    const { exitCode, stdout, stderr } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply"],
      { env: applyEnv(fakeHome) },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/induced failure|failed/i);
    expect(stderr).toMatch(/bak-relocate/);
    expect(stdout).not.toContain("Relocated");
    expect(dbBytes(db.dbPath).equals(before)).toBe(true);
    expect(sessionRows(db.dbPath).every((row) => row.directory.startsWith("C:/dev/foo") || row.directory === "C:/dev/unrelated")).toBe(true);
  });
});

describe("relocate argument and DB guards", () => {
  test("missing --from fails with a clear error", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.close();

    const { exitCode, stderr } = await runCli(["relocate", "--db", db.dbPath, "--to", "C:/dev/bar"], {
      env: fakeHome.env,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--from/);
  });

  test("missing --apply with tidy-up flag still stays read-only", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const before = dbBytes(db.dbPath);
    const { exitCode } = await runCli(
      [
        "relocate",
        "--db",
        db.dbPath,
        "--from",
        "C:/dev/foo",
        "--to",
        "C:/dev/bar",
        "--also-project-tables",
      ],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    expect(dbBytes(db.dbPath).equals(before)).toBe(true);
  });
});

describe("relocate never creates a missing Global DB", () => {
  test("a --db path that does not exist errors and is still absent afterwards", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.close();
    const missing = joined(db.dir, "missing.db");

    const { exitCode, stderr } = await runCli(
      ["relocate", "--db", missing, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/not found/i);
    expect(existsSync(missing)).toBe(false);
  });
});

describe("relocate under the Node driver (node:sqlite)", () => {
  const major = nodeMajorVersion();

  test.skipIf(major === null || major < 24)("applies the relocation under Node >= 24", async () => {
    const fakeHome = createFakeHome();
    const db = seedStandardDb();
    db.close();

    const { exitCode, stdout } = await runCli(
      ["relocate", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply"],
      { env: applyEnv(fakeHome), runtime: "node" },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Relocated 3 sessions");
    expect(sessionRows(db.dbPath)[0]?.directory).toBe("C:/dev/bar");
    expect(sessionRows(db.dbPath)[3]?.directory).toBe("C:/dev/unrelated");
  });
});
