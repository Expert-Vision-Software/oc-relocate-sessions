import { describe, test, expect } from "bun:test";
import { resolveRuntimeBin, runCli } from "./helpers/spawn-cli.js";
import { VERSION } from "../src/version.js";

describe("test spawn runtime resolution", () => {
  test("default runtime spawns the CLI with the runner binary", () => {
    delete process.env.OC_RELOCATE_TEST_RUNTIME;
    expect(resolveRuntimeBin()).toBe(process.execPath);
  });

  test("explicit node runtime spawns the CLI with node", () => {
    delete process.env.OC_RELOCATE_TEST_RUNTIME;
    const nodeBin = Bun.which("node");
    if (nodeBin === null) return;
    expect(resolveRuntimeBin("node")).toBe(nodeBin);
  });

  test("OC_RELOCATE_TEST_RUNTIME=node flips the default runtime to node (CI matrix leg)", () => {
    const nodeBin = Bun.which("node");
    if (nodeBin === null) return;
    process.env.OC_RELOCATE_TEST_RUNTIME = "node";
    try {
      expect(resolveRuntimeBin()).toBe(nodeBin);
      expect(resolveRuntimeBin()).not.toBe(process.execPath);
    } finally {
      delete process.env.OC_RELOCATE_TEST_RUNTIME;
    }
  });

  test("other values of OC_RELOCATE_TEST_RUNTIME are ignored", () => {
    const nodeBin = Bun.which("node");
    if (nodeBin === null) return;
    process.env.OC_RELOCATE_TEST_RUNTIME = "bun";
    try {
      expect(resolveRuntimeBin()).toBe(process.execPath);
    } finally {
      delete process.env.OC_RELOCATE_TEST_RUNTIME;
    }
  });

  test("CLI answers --version when spawned through the override", async () => {
    const nodeBin = Bun.which("node");
    if (nodeBin === null) return;
    process.env.OC_RELOCATE_TEST_RUNTIME = "node";
    try {
      const { exitCode, stdout } = await runCli(["--version"]);
      expect(exitCode).toBe(0);
      expect(stdout).toBe(`${VERSION}\n`);
    } finally {
      delete process.env.OC_RELOCATE_TEST_RUNTIME;
    }
  });
});
