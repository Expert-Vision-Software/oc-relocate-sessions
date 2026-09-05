import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "./helpers/spawn-cli.js";
import { createSyntheticDb } from "./helpers/synthetic-db.js";
import { createFakeHome, installDb } from "./helpers/data-dir.js";

function nodeMajorVersion(): number | null {
  const nodeBin = Bun.which("node");
  if (nodeBin === null) return null;
  const proc = Bun.spawnSync([nodeBin, "--version"]);
  const version = proc.stdout.toString().trim();
  const major = Number.parseInt(version.replace(/^v/, "").split(".")[0] ?? "0", 10);
  return Number.isNaN(major) ? null : major;
}

const major = nodeMajorVersion();

interface Scenario {
  name: string;
  run: (runtime: "default" | "node") => Promise<void>;
}

const parityScenarios: Scenario[] = [
  {
    name: "list --json reports totals through the seam",
    run: async (runtime) => {
      const fakeHome = createFakeHome();
      const db = createSyntheticDb();
      db.insertProject({ id: "p1" });
      db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
      db.insertSession({ id: "s2", projectId: "p1", directory: "C:/dev/foo/sub" });
      db.close();
      const { exitCode, stdout } = await runCli(["list", "--db", db.dbPath, "--json"], {
        env: fakeHome.env,
        runtime,
      });
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { totals: { projects: number; sessions: number; directories: number } };
      expect(parsed.totals).toEqual({ projects: 1, sessions: 2, directories: 2 });
    },
  },
  {
    name: "flag beats env for resolution",
    run: async (runtime) => {
      const fakeHome = createFakeHome();
      const envDb = createSyntheticDb();
      envDb.insertSession({ id: "s1", projectId: "p1", directory: "C:/old/env-only" });
      const flagDb = createSyntheticDb();
      flagDb.insertSession({ id: "s2", projectId: "p1", directory: "C:/old/flag-only" });
      envDb.close();
      flagDb.close();
      const { exitCode, stdout } = await runCli(["list", "--db", flagDb.dbPath, "--json"], {
        env: { ...fakeHome.env, OPENCODE_DB: envDb.dbPath },
        runtime,
      });
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { directories: { directory: string }[] };
      expect(parsed.directories.map((d) => d.directory)).toEqual(["C:/old/flag-only"]);
    },
  },
  {
    name: "dbs --json discovers the newest channel match",
    run: async (runtime) => {
      const fakeHome = createFakeHome();
      const stable = createSyntheticDb();
      stable.close();
      const beta = createSyntheticDb();
      beta.close();
      installDb(stable.dbPath, fakeHome.dataDir, "opencode.db", new Date("2026-09-04T10:00:00Z"));
      installDb(beta.dbPath, fakeHome.dataDir, "opencode-beta.db", new Date("2026-09-05T10:00:00Z"));
      const { exitCode, stdout } = await runCli(["dbs", "--json"], { env: fakeHome.env, runtime });
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { resolved: { path: string; source: string; channel: string } };
      expect(parsed.resolved).toEqual({
        path: join(fakeHome.dataDir, "opencode-beta.db"),
        source: "discovered",
        channel: "beta",
      });
    },
  },
  {
    name: "missing DB errors and no file is created",
    run: async (runtime) => {
      const fakeHome = createFakeHome();
      const missing = join(fakeHome.home, "missing-node.db");
      const { exitCode, stderr } = await runCli(["list", "--db", missing], {
        env: fakeHome.env,
        runtime,
      });
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/not found/i);
      expect(existsSync(missing)).toBe(false);
    },
  },
];

describe("driver adapter parity (node:sqlite)", () => {
  test.skipIf(major === null || major < 24)("same CLI behavior under Node >= 24", async () => {
    if (major === null || major < 24) return;
    for (const scenario of parityScenarios) {
      await scenario.run("node");
    }
  });

  test.skipIf(major === null || major >= 24)("Node < 24 gets an actionable error pointing at bunx", async () => {
    if (major === null || major >= 24) return;
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.close();

    const { exitCode, stdout, stderr } = await runCli(["list", "--db", db.dbPath], {
      env: fakeHome.env,
      runtime: "node",
    });

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/Node >= 24/);
    expect(stderr).toMatch(/bunx/);
  });
});
