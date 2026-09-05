import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "./helpers/spawn-cli.js";
import { createSyntheticDb } from "./helpers/synthetic-db.js";
import { createFakeHome } from "./helpers/data-dir.js";

function nodeMajorVersion(): number | null {
  const nodeBin = Bun.which("node");
  if (nodeBin === null) return null;
  const proc = Bun.spawnSync([nodeBin, "--version"]);
  const version = proc.stdout.toString().trim();
  const major = Number.parseInt(version.replace(/^v/, "").split(".")[0] ?? "0", 10);
  return Number.isNaN(major) ? null : major;
}

describe("driver adapter parity (node:sqlite)", () => {
  const major = nodeMajorVersion();

  test.skipIf(major === null || major < 24)("same CLI behavior under Node >= 24", async () => {
    if (major === null || major < 24) return;
    const fakeHome = createFakeHome();
    const db = createSyntheticDb();
    db.insertProject({ id: "p1" });
    db.insertSession({ id: "s1", projectId: "p1", directory: "C:/dev/foo" });
    db.close();

    const ok = await runCli(["list", "--db", db.dbPath, "--json"], {
      env: fakeHome.env,
      runtime: "node",
    });
    expect(ok.exitCode).toBe(0);
    const parsed = JSON.parse(ok.stdout) as { totals: { projects: number; sessions: number } };
    expect(parsed.totals).toEqual({ projects: 1, sessions: 1 });

    const missing = join(fakeHome.home, "missing-node.db");
    const fail = await runCli(["list", "--db", missing], { env: fakeHome.env, runtime: "node" });
    expect(fail.exitCode).toBe(1);
    expect(fail.stderr).toMatch(/not found/i);
    expect(existsSync(missing)).toBe(false);
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
