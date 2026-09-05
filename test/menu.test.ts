import { describe, test, expect } from "bun:test";
import { runCli, runCliInteractive, type InteractiveStep } from "./helpers/spawn-cli.js";
import { createSyntheticDb } from "./helpers/synthetic-db.js";
import { createFakeHome, installDb } from "./helpers/data-dir.js";
import { backupFiles, sessionRows } from "./helpers/db-inspect.js";
import { nodeMajorVersion } from "./helpers/node-version.js";
import { VERSION } from "../src/version.js";

const DETECTOR_ENV = "OC_RELOCATE_PROCESS_DETECTOR_OUTPUT";
const FROM = "C:/relocate-test/old";
const TO = "C:/relocate-test/new";

function installedDb(): { dbPath: string; env: Record<string, string>; dir: string } {
  const synthetic = createSyntheticDb();
  synthetic.insertSession({ id: "s1", projectId: "p1", directory: FROM });
  synthetic.insertSession({ id: "s2", projectId: "p1", directory: `${FROM}/sub` });
  synthetic.insertProjectDirectory({ id: "pd1", projectId: "p1", directory: FROM });
  synthetic.close();

  const fakeHome = createFakeHome();
  const dbPath = installDb(synthetic.dbPath, fakeHome.dataDir, "opencode.db");
  return { dbPath, env: fakeHome.env, dir: fakeHome.dataDir };
}

function menuEnv(fake: { env: Record<string, string> }): Record<string, string> {
  return { ...fake.env, OC_RELOCATE_MENU: "1", [DETECTOR_ENV]: "INFO: No tasks are running." };
}

const APPLY_SCRIPT: InteractiveStep[] = [
  { after: "What would you like to do?", data: "\r" },
  { after: "Relocate from", data: "\r" },
  { after: "Relocate to", data: `${TO}\r` },
  { after: "tidy-up", data: "\r" },
  { after: "Apply this relocation", data: "y" },
];

const DECLINE_SCRIPT: InteractiveStep[] = [
  { after: "What would you like to do?", data: "\r" },
  { after: "Relocate from", data: "\r" },
  { after: "Relocate to", data: `${TO}\r` },
  { after: "tidy-up", data: "\r" },
  { after: "Apply this relocation", data: "n" },
];

describe("interactive menu routing", () => {
  test("bare invocation without a TTY still prints help and exits 1", async () => {
    const { exitCode, stdout } = await runCli([]);

    expect(exitCode).toBe(1);
    expect(stdout).toContain("Usage:");
  });

  test("OC_RELOCATE_MENU=1 opens the menu; Ctrl-C exits cleanly", async () => {
    const fake = installedDb();
    const { exitCode, stdout } = await runCli([], { env: menuEnv(fake), stdin: "\x03" });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`oc-relocate v${VERSION}`);
    expect(stdout).toMatch(/cancelled/i);
  }, 15000);
});

describe("interactive menu actions", () => {
  test("Help action prints the direct-command help", async () => {
    const fake = installedDb();
    const { exitCode, stdout } = await runCli([], {
      env: menuEnv(fake),
      stdin: "\x1b[B\x1b[B\r",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("relocate --from");
  }, 15000);

  test("Version action prints the package version", async () => {
    const fake = installedDb();
    const { exitCode, stdout } = await runCli([], {
      env: menuEnv(fake),
      stdin: "\x1b[B\x1b[B\x1b[B\r",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(VERSION);
  }, 15000);

  test("Inspect action reuses list against the resolved DB", async () => {
    const fake = installedDb();
    const { exitCode, stdout } = await runCli([], {
      env: menuEnv(fake),
      stdin: "\x1b[B\r",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Sessions by directory:");
    expect(stdout).toContain(FROM);
  }, 15000);
});

describe("interactive relocate flow", () => {
  test("stages run in order, applies, and prints the exact direct command", async () => {
    const fake = installedDb();
    const { exitCode, stdout } = await runCliInteractive([], {
      env: menuEnv(fake),
      script: APPLY_SCRIPT,
    });

    expect(exitCode).toBe(0);
    const fromAt = stdout.indexOf("Relocate from");
    const toAt = stdout.indexOf("Relocate to");
    const previewAt = stdout.indexOf("Affected sessions: 2");
    const confirmAt = stdout.indexOf("Apply this relocation");
    expect(fromAt).toBeGreaterThan(-1);
    expect(toAt).toBeGreaterThan(fromAt);
    expect(previewAt).toBeGreaterThan(toAt);
    expect(confirmAt).toBeGreaterThan(previewAt);
    expect(stdout).toContain("Relocated 2 sessions");
    expect(stdout).toContain(
      `oc-relocate relocate --from ${FROM} --to ${TO} --db ${fake.dbPath} --apply`,
    );
    expect(sessionRows(fake.dbPath)).toEqual([
      { id: "s1", directory: TO },
      { id: "s2", directory: `${TO}/sub` },
    ]);
    expect(backupFiles(fake.dir)).toHaveLength(1);
  }, 20000);

  test("answering no at the confirm gate leaves the DB untouched and recommends plan", async () => {
    const fake = installedDb();
    const { exitCode, stdout } = await runCliInteractive([], {
      env: menuEnv(fake),
      script: DECLINE_SCRIPT,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/nothing was changed/i);
    expect(stdout).toContain(
      `oc-relocate plan --from ${FROM} --to ${TO} --db ${fake.dbPath}`,
    );
    expect(backupFiles(fake.dir)).toEqual([]);
    expect(sessionRows(fake.dbPath)).toEqual([
      { id: "s1", directory: FROM },
      { id: "s2", directory: `${FROM}/sub` },
    ]);

    const printed = stdout.match(/oc-relocate plan [^\r\n]+/);
    expect(printed).not.toBeNull();
    const args = printed![0].trim().split(/\s+/).slice(1);
    const executed = await runCli(args, { env: fake.env });
    expect(executed.exitCode).toBe(0);
    expect(executed.stdout).toMatch(/no changes were made/i);
  }, 20000);

  test("the applied menu flow and the equivalent direct command produce identical DB state", async () => {
    const menuDb = installedDb();
    await runCliInteractive([], { env: menuEnv(menuDb), script: APPLY_SCRIPT });

    const directDb = installedDb();
    const direct = await runCli(
      ["relocate", "--db", directDb.dbPath, "--from", FROM, "--to", TO, "--apply"],
      {
        env: {
          ...directDb.env,
          [DETECTOR_ENV]: "INFO: No tasks are running.",
        },
      },
    );
    expect(direct.exitCode).toBe(0);

    expect(sessionRows(menuDb.dbPath)).toEqual(sessionRows(directDb.dbPath));
  }, 30000);

  const major = nodeMajorVersion();

  test.skipIf(major === null || major < 24)("guided relocate applies under Node >= 24", async () => {
    const fake = installedDb();
    const { exitCode, stdout } = await runCliInteractive([], {
      env: menuEnv(fake),
      script: APPLY_SCRIPT,
      runtime: "node",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Relocated 2 sessions");
    expect(sessionRows(fake.dbPath)).toEqual([
      { id: "s1", directory: TO },
      { id: "s2", directory: `${TO}/sub` },
    ]);
    expect(backupFiles(fake.dir)).toHaveLength(1);
  }, 30000);
});
