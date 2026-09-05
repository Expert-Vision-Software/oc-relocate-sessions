import { describe, test, expect } from "bun:test";
import { runCli } from "./helpers/spawn-cli.js";
import { createSyntheticDb } from "./helpers/synthetic-db.js";
import { createFakeHome } from "./helpers/data-dir.js";

describe("list subcommand", () => {
  test("text output groups session counts by directory, newest count first", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertProject({ id: "p1" });
    db.insertProject({ id: "p2" });
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    db.insertSession({ id: "s2", projectId: "p1", directory: "C:/dev/foo" });
    db.insertSession({ id: "s3", projectId: "p1", directory: "C:/dev/foo" });
    db.insertSession({ id: "s4", projectId: "p2", directory: "C:/dev/bar" });
    db.close();

    const { exitCode, stdout } = await runCli(["list", "--db", db.dbPath], { env: fakeHome.env });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Global DB: ${db.dbPath}`);
    expect(stdout).toContain("Projects: 2");
    expect(stdout).toContain("Sessions: 4 across 2 directories");
    expect(stdout).toContain("Sessions by directory:");
    const fooLine = stdout.indexOf("C:/dev/foo");
    const barLine = stdout.indexOf("C:/dev/bar");
    expect(fooLine).toBeGreaterThan(-1);
    expect(barLine).toBeGreaterThan(-1);
    expect(stdout.slice(fooLine - 6, fooLine)).toContain("3");
    expect(stdout.slice(barLine - 6, barLine)).toContain("1");
    expect(fooLine).toBeLessThan(barLine);
  });

  test("--json output has totals and per-directory counts", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertProject({ id: "p1" });
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    db.insertSession({ id: "s2", projectId: "p1", directory: "C:/dev/foo/sub" });
    db.close();

    const { exitCode, stdout } = await runCli(["list", "--db", db.dbPath, "--json"], {
      env: fakeHome.env,
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      db: string;
      totals: { projects: number; sessions: number; directories: number };
      directories: { directory: string; sessions: number }[];
    };
    expect(parsed.db).toBe(db.dbPath);
    expect(parsed.totals).toEqual({ projects: 1, sessions: 2, directories: 2 });
    expect(parsed.directories).toEqual([
      { directory: "C:/dev/foo", sessions: 1 },
      { directory: "C:/dev/foo/sub", sessions: 1 },
    ]);
  });

  test("empty DB reports zero totals", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.close();

    const { exitCode, stdout } = await runCli(["list", "--db", db.dbPath, "--json"], {
      env: fakeHome.env,
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      totals: { projects: number; sessions: number; directories: number };
      directories: unknown[];
    };
    expect(parsed.totals).toEqual({ projects: 0, sessions: 0, directories: 0 });
    expect(parsed.directories).toEqual([]);
  });
});

describe("WAL warning", () => {
  test("warns (non-fatal) when the -wal sidecar is large", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb({ wal: true });
    const payload = "x".repeat(1024);
    for (let i = 0; i < 3000; i++) {
      db.insertSession({ id: `s${i}`, projectId: "p1", directory: `C:/dev/foo/session-${i}/${payload}` });
    }

    const { exitCode, stdout, stderr } = await runCli(["list", "--db", db.dbPath, "--json"], {
      env: fakeHome.env,
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { totals: { sessions: number } };
    expect(parsed.totals.sessions).toBe(3000);
    expect(stderr).toMatch(/-wal/i);
    expect(stderr).toMatch(/opencode/i);
    db.close();
  });

  test("no warning for a small or absent WAL sidecar", async () => {
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    db.close();

    const { exitCode, stderr } = await runCli(["list", "--db", db.dbPath], { env: fakeHome.env });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });
});
