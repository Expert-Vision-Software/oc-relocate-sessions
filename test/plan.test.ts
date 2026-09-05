import { describe, test, expect } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { runCli } from "./helpers/spawn-cli.js";
import { createSyntheticDb } from "./helpers/synthetic-db.js";
import { createFakeHome } from "./helpers/data-dir.js";

const fwd = (value: string): string => value.replaceAll("\\", "/");
const native = (value: string): string => (sep === "\\" ? value.replaceAll("/", "\\") : value);
const joined = (base: string, ...parts: string[]): string => fwd(join(base, ...parts));

interface PlanJson {
  db: string;
  from: string;
  to: string;
  toExists: boolean;
  alsoProjectTables: boolean;
  changed: false;
  totals: { sessions: number; directories: number };
  sessions: { id: string; projectId: string; directory: string; path: string }[];
  directories: { directory: string; sessions: number }[];
  tidyUp?: { project: number; projectDirectory: number; workspace: number };
}

function dbBytes(dbPath: string): Buffer {
  return readFileSync(dbPath);
}

describe("plan path normalization", () => {
  test("backslash and trailing-slash inputs match forward-slash DB values", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    db.insertSession({ id: "s2", projectId: "p1", directory: "C:/dev/foo" });
    db.insertSession({ id: "s3", projectId: "p1", directory: "C:/dev/other" });
    db.close();

    const { exitCode, stdout } = await runCli(
      ["plan", "--db", db.dbPath, "--from", "C:\\dev\\foo\\", "--to", "C:\\dev\\bar\\"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Affected sessions: 2");
    expect(stdout).not.toContain("C:/dev/other");
  });

  test("relative --from resolves against the current working directory", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    const cwd = realpathSync(db.dir);
    db.insertSession({ id: "s1", projectId: "p1", directory: joined(cwd, "dev", "foo") });
    db.close();

    const { exitCode, stdout } = await runCli(
      ["plan", "--db", db.dbPath, "--from", "dev/foo", "--to", "dev/bar", "--json"],
      { env: fakeHome.env, cwd },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as PlanJson;
    expect(parsed.from).toBe(joined(cwd, "dev", "foo"));
    expect(parsed.to).toBe(joined(cwd, "dev", "bar"));
    expect(parsed.totals).toEqual({ sessions: 1, directories: 1 });
  });

  test("refuses --from equal to --to after normalization", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.close();

    const { exitCode, stderr } = await runCli(
      ["plan", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:\\dev\\foo\\"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/same/i);
  });
});

describe("plan prefix-scoped preview", () => {
  test("includes subdirectory sessions, groups counts by directory", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    db.insertSession({ id: "s2", projectId: "p1", directory: "C:/dev/foo" });
    db.insertSession({ id: "s3", projectId: "p1", directory: "C:/dev/foo/sub" });
    db.insertSession({ id: "s4", projectId: "p1", directory: "C:/dev/unrelated" });
    db.close();

    const { exitCode, stdout } = await runCli(
      ["plan", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--json"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as PlanJson;
    expect(parsed.totals).toEqual({ sessions: 3, directories: 2 });
    expect(parsed.directories).toEqual([
      { directory: "C:/dev/foo", sessions: 2 },
      { directory: "C:/dev/foo/sub", sessions: 1 },
    ]);
    expect(parsed.sessions.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  test("text output shows native separators for humans and states nothing changed", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo", path: "packages/app" });
    db.close();

    const { exitCode, stdout } = await runCli(
      ["plan", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`From: ${native("C:/dev/foo")}`);
    expect(stdout).toContain(`To: ${native("C:/dev/bar")}`);
    expect(stdout).toContain(native("C:/dev/foo"));
    expect(stdout).toContain("s1");
    expect(stdout).toMatch(/no changes were made/i);
  });
});

describe("plan --json shape", () => {
  test("full machine-readable plan", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo", path: "packages/app" });
    db.insertSession({ id: "s2", projectId: "p2", directory: "C:/dev/foo" });
    db.close();

    const { exitCode, stdout } = await runCli(
      ["plan", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:\\dev\\bar\\", "--json"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as PlanJson;
    expect(parsed).toEqual({
      db: db.dbPath,
      from: "C:/dev/foo",
      to: "C:/dev/bar",
      toExists: false,
      alsoProjectTables: false,
      changed: false,
      totals: { sessions: 2, directories: 1 },
      sessions: [
        { id: "s1", projectId: "p1", directory: "C:/dev/foo", path: "packages/app" },
        { id: "s2", projectId: "p2", directory: "C:/dev/foo", path: "" },
      ],
      directories: [{ directory: "C:/dev/foo", sessions: 2 }],
    });
  });
});

describe("plan dry-run safety", () => {
  test("plan leaves the DB byte-identical", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertProject({ id: "p1", worktree: "C:/dev/foo" });
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    db.insertSession({ id: "s2", projectId: "p1", directory: "C:/dev/foo/sub" });
    db.close();

    const before = dbBytes(db.dbPath);
    expect(before.length).toBeGreaterThan(0);

    const { exitCode, stdout } = await runCli(
      [
        "plan",
        "--db",
        db.dbPath,
        "--from",
        "C:/dev/foo",
        "--to",
        "C:/dev/bar",
        "--also-project-tables",
        "--json",
      ],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as PlanJson;
    expect(parsed.totals.sessions).toBe(2);
    expect(dbBytes(db.dbPath).equals(before)).toBe(true);
  });
});

describe("plan --to existence warning", () => {
  test("warns non-fatally when --to does not exist on disk", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    db.close();

    const missingTo = joined(db.dir, "not-there");
    const { exitCode, stdout, stderr } = await runCli(
      ["plan", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", missingTo, "--json"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as PlanJson;
    expect(parsed.toExists).toBe(false);
    expect(stderr).toMatch(/warning/i);
    expect(stderr).toContain(native(missingTo));
  });

  test("no warning when --to exists on disk", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    db.close();

    const { exitCode, stderr } = await runCli(
      ["plan", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", db.dir],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });
});

describe("plan tidy-up scope (--also-project-tables)", () => {
  test("reports project/workspace rows without touching the DB", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertProject({
      id: "p1",
      worktree: "C:/dev/foo",
      sandboxes: JSON.stringify(["C:/dev/foo/x"]),
    });
    db.insertProject({ id: "p2", worktree: "C:/elsewhere" });
    db.insertProjectDirectory({ id: "pd1", projectId: "p1", directory: "C:/dev/foo" });
    db.insertWorkspace({ id: "w1", directory: "C:/dev/foo" });
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    db.close();

    const before = dbBytes(db.dbPath);
    const { exitCode, stdout } = await runCli(
      [
        "plan",
        "--db",
        db.dbPath,
        "--from",
        "C:/dev/foo",
        "--to",
        "C:/dev/bar",
        "--also-project-tables",
        "--json",
      ],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as PlanJson;
    expect(parsed.alsoProjectTables).toBe(true);
    expect(parsed.tidyUp).toEqual({ project: 1, projectDirectory: 1, workspace: 1 });
    expect(dbBytes(db.dbPath).equals(before)).toBe(true);
  });

  test("default plan omits the tidy-up section entirely", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertProject({ id: "p1", worktree: "C:/dev/foo" });
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    db.close();

    const { exitCode, stdout } = await runCli(
      ["plan", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--json"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as PlanJson;
    expect(parsed.alsoProjectTables).toBe(false);
    expect("tidyUp" in parsed).toBe(false);
  });

  test("text output reflects the tidy-up scope", async () => {
    const fakeHome = createFakeHome();
    const on = createSyntheticDb();
    on.insertProject({ id: "p1", worktree: "C:/dev/foo" });
    on.insertProjectDirectory({ id: "pd1", projectId: "p1", directory: "C:/dev/foo" });
    on.insertWorkspace({ id: "w1", directory: "C:/dev/foo" });
    on.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    on.close();

    const { exitCode, stdout } = await runCli(
      [
        "plan",
        "--db",
        on.dbPath,
        "--from",
        "C:/dev/foo",
        "--to",
        "C:/dev/bar",
        "--also-project-tables",
      ],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/tidy-up scope/i);
    expect(stdout).toContain("project: 1");
    expect(stdout).toContain("project_directory: 1");
    expect(stdout).toContain("workspace: 1");
  });
});

describe("plan argument validation", () => {
  test("missing --from fails with a clear error", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.close();

    const { exitCode, stderr } = await runCli(["plan", "--db", db.dbPath, "--to", "C:/dev/bar"], {
      env: fakeHome.env,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--from/);
  });

  test("missing --to fails with a clear error", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.close();

    const { exitCode, stderr } = await runCli(["plan", "--db", db.dbPath, "--from", "C:/dev/foo"], {
      env: fakeHome.env,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--to/);
  });

  test("unknown options are rejected (plan never accepts --apply)", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.close();

    const { exitCode, stderr } = await runCli(
      ["plan", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--apply"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/unknown option: --apply/);
  });
});

describe("plan reads sessions without rewriting them", () => {
  test("selected columns cover id, project_id, directory, path", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertSession({
      id: "s1",
      projectId: "p1",
      directory: "C:/dev/foo",
      path: "packages/app/src/index.ts",
    });
    db.close();

    const { exitCode, stdout } = await runCli(
      ["plan", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--json"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as PlanJson;
    expect(parsed.sessions).toEqual([
      {
        id: "s1",
        projectId: "p1",
        directory: "C:/dev/foo",
        path: "packages/app/src/index.ts",
      },
    ]);
  });
});

describe("plan for an empty match set", () => {
  test("zero sessions still succeeds with an empty plan", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/unrelated" });
    db.close();

    const { exitCode, stdout } = await runCli(
      ["plan", "--db", db.dbPath, "--from", "C:/dev/foo", "--to", "C:/dev/bar", "--json"],
      { env: fakeHome.env },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as PlanJson;
    expect(parsed.totals).toEqual({ sessions: 0, directories: 0 });
    expect(parsed.sessions).toEqual([]);
    expect(parsed.directories).toEqual([]);
  });
});
