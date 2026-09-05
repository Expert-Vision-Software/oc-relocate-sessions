import { describe, test, expect } from "bun:test";
import { runCli } from "./helpers/spawn-cli.js";
import { VERSION } from "../src/version.js";
import pkg from "../package.json" with { type: "json" };

describe("CLI process boundary", () => {
  test("--help exits 0 and lists subcommands", async () => {
    const { exitCode, stdout } = await runCli(["--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("oc-relocate");
    expect(stdout).toContain("relocate");
    expect(stdout).toContain("plan");
    expect(stdout).toContain("list");
    expect(stdout).toContain("dbs");
  });

  test("--version exits 0 and prints the package version", async () => {
    const { exitCode, stdout } = await runCli(["--version"]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe(`${VERSION}\n`);
  });

  test("CLI VERSION matches package.json version", () => {
    expect(pkg.version).toBe(VERSION);
  });

  test("no args on non-TTY prints help and exits 1", async () => {
    const { exitCode, stdout } = await runCli([]);

    expect(exitCode).toBe(1);
    expect(stdout).toContain("oc-relocate");
  });
});
