import { join } from "node:path";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const cliPath = join(import.meta.dir, "..", "..", "dist", "cli.js");

export async function runCli(
  args: string[],
  opts: { env?: Record<string, string>; runtime?: "default" | "node" } = {},
): Promise<CliResult> {
  const bin = opts.runtime === "node" ? (Bun.which("node") ?? "node") : process.execPath;
  const proc = Bun.spawn({
    cmd: [bin, cliPath, ...args],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...opts.env },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}
