import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "./helpers/spawn-cli.js";
import { createSyntheticDb } from "./helpers/synthetic-db.js";
import { createFakeHome, installDb } from "./helpers/data-dir.js";

function makeDb(directories: string[]) {
  const db = createSyntheticDb();
  directories.forEach((directory, i) => {
    db.insertSession({ id: `s${i}`, projectId: "p1", directory });
  });
  return db;
}

describe("DB resolution order (flag > env > newest channel)", () => {
  test("--db flag beats OPENCODE_DB env", async () => {
    const envDb = makeDb(["C:/old/env-only"]);
    const flagDb = makeDb(["C:/old/flag-only"]);

    const { exitCode, stdout } = await runCli(["list", "--db", flagDb.dbPath, "--json"], {
      env: { OPENCODE_DB: envDb.dbPath },
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { db: string; directories: { directory: string }[] };
    expect(parsed.db).toBe(flagDb.dbPath);
    expect(parsed.directories.map((d) => d.directory)).toEqual(["C:/old/flag-only"]);

    envDb.close();
    flagDb.close();
  });

  test("OPENCODE_DB env beats newest discovered file", async () => {
    const fakeHome = createFakeHome();
    const discovered = makeDb(["C:/old/discovered"]);
    discovered.close();
    installDb(discovered.dbPath, fakeHome.dataDir, "opencode.db", new Date("2026-09-05T12:00:00Z"));

    const envDb = makeDb(["C:/old/env-only"]);

    const { exitCode, stdout } = await runCli(["list", "--json"], {
      env: { ...fakeHome.env, OPENCODE_DB: envDb.dbPath },
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { db: string };
    expect(parsed.db).toBe(envDb.dbPath);

    envDb.close();
  });

  test("dbs --json marks the newest channel match as resolved default", async () => {
    const fakeHome = createFakeHome();
    const stable = makeDb([]);
    stable.close();
    const beta = makeDb([]);
    beta.close();
    installDb(stable.dbPath, fakeHome.dataDir, "opencode.db", new Date("2026-09-04T10:00:00Z"));
    installDb(beta.dbPath, fakeHome.dataDir, "opencode-beta.db", new Date("2026-09-05T10:00:00Z"));
    installDb(stable.dbPath, fakeHome.dataDir, "opencode.db.bak", new Date("2026-09-05T11:00:00Z"));

    const { exitCode, stdout } = await runCli(["dbs", "--json"], { env: fakeHome.env });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      dataDir: string;
      resolved: { path: string; source: string; channel: string };
      candidates: { path: string; channel: string; sizeBytes: number; walBytes: number; mtimeMs: number; mtime: string }[];
    };
    expect(parsed.dataDir).toBe(fakeHome.dataDir);
    expect(parsed.resolved).toEqual({
      path: join(fakeHome.dataDir, "opencode-beta.db"),
      source: "discovered",
      channel: "beta",
    });
    expect(parsed.candidates).toHaveLength(2);
    expect(parsed.candidates[0]?.path).toBe(join(fakeHome.dataDir, "opencode-beta.db"));
    expect(parsed.candidates[0]?.channel).toBe("beta");
    expect(parsed.candidates[1]?.channel).toBe("stable");
    expect(parsed.candidates[1]?.path).toBe(join(fakeHome.dataDir, "opencode.db"));
    expect(parsed.candidates[0]?.sizeBytes).toBeGreaterThan(0);
    expect(parsed.candidates[0]?.walBytes).toBe(0);
    expect(parsed.candidates[0]?.mtime).toBe("2026-09-05T10:00:00.000Z");
    expect(parsed.candidates[0]?.mtimeMs).toBeGreaterThan(0);
  });

  test("dbs text marks the resolved default and reports candidate fields", async () => {
    const fakeHome = createFakeHome();
    const stable = makeDb([]);
    stable.close();
    const beta = makeDb([]);
    beta.close();
    installDb(stable.dbPath, fakeHome.dataDir, "opencode.db", new Date("2026-09-04T10:00:00Z"));
    installDb(beta.dbPath, fakeHome.dataDir, "opencode-beta.db", new Date("2026-09-05T10:00:00Z"));

    const { exitCode, stdout } = await runCli(["dbs"], { env: fakeHome.env });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Global DB candidates");
    expect(stdout).toContain(fakeHome.dataDir);
    expect(stdout).toContain(`* ${join(fakeHome.dataDir, "opencode-beta.db")}`);
    expect(stdout).toContain("channel=beta");
    expect(stdout).toContain("channel=stable");
    expect(stdout).toContain("modified=2026-09-05T10:00:00.000Z");
    expect(stdout).toContain(`Resolved Global DB: ${join(fakeHome.dataDir, "opencode-beta.db")} (newest channel match)`);
  });

  test("dbs reports a --db override as the resolution source", async () => {
    const fakeHome = createFakeHome();
    const db = makeDb([]);
    db.close();

    const { exitCode, stdout } = await runCli(["dbs", "--db", db.dbPath, "--json"], { env: fakeHome.env });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { resolved: { path: string; source: string } };
    expect(parsed.resolved.source).toBe("flag");
    expect(parsed.resolved.path).toBe(db.dbPath);
  });

  test("dbs text labels an OPENCODE_DB override", async () => {
    const fakeHome = createFakeHome();
    const db = makeDb([]);
    db.close();

    const { exitCode, stdout } = await runCli(["dbs"], {
      env: { ...fakeHome.env, OPENCODE_DB: db.dbPath },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Resolved Global DB: ${db.dbPath} (via OPENCODE_DB)`);
  });
});

describe("No-create guard", () => {
  test("missing --db path errors and never creates the file", async () => {
    const fakeHome = createFakeHome();
    const missing = join(fakeHome.home, "missing.db");

    const { exitCode, stdout, stderr } = await runCli(["list", "--db", missing, "--json"], {
      env: fakeHome.env,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain(missing);
    expect(stderr).toMatch(/not found/i);
    expect(stdout).toBe("");
    expect(existsSync(missing)).toBe(false);
  });

  test("missing OPENCODE_DB path errors and never creates the file", async () => {
    const fakeHome = createFakeHome();
    const missing = join(fakeHome.home, "missing-env.db");

    const { exitCode, stderr } = await runCli(["list"], {
      env: { ...fakeHome.env, OPENCODE_DB: missing },
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain(missing);
    expect(existsSync(missing)).toBe(false);
  });

  test(":memory: is rejected for --db", async () => {
    const fakeHome = createFakeHome();

    const { exitCode, stderr } = await runCli(["list", "--db", ":memory:"], { env: fakeHome.env });

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/:memory:/);
    expect(stderr).toMatch(/not supported/i);
  });

  test(":memory: is rejected for OPENCODE_DB", async () => {
    const fakeHome = createFakeHome();

    const { exitCode, stderr } = await runCli(["list"], {
      env: { ...fakeHome.env, OPENCODE_DB: ":memory:" },
    });

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/:memory:/);
    expect(stderr).toMatch(/not supported/i);
  });

  test("no candidates in the data dir errors with the searched directory", async () => {
    const fakeHome = createFakeHome();

    const { exitCode, stderr } = await runCli(["list"], { env: fakeHome.env });

    expect(exitCode).toBe(1);
    expect(stderr).toContain(fakeHome.dataDir);
    expect(stderr).toMatch(/no Global DB/i);
  });

  test("dbs with no candidates errors with the searched directory", async () => {
    const fakeHome = createFakeHome();

    const { exitCode, stderr } = await runCli(["dbs"], { env: fakeHome.env });

    expect(exitCode).toBe(1);
    expect(stderr).toContain(fakeHome.dataDir);
    expect(stderr).toMatch(/no Global DB/i);
  });

  test("--db followed by a flag is a usage error, not a path", async () => {
    const fakeHome = createFakeHome();

    const { exitCode, stderr } = await runCli(["list", "--db", "--json"], { env: fakeHome.env });

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--db requires a <path> value/);
  });

  test("--db with an empty value is a usage error", async () => {
    const fakeHome = createFakeHome();

    const { exitCode, stderr } = await runCli(["list", "--db", ""], { env: fakeHome.env });

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/non-empty <path>/);
  });
});
