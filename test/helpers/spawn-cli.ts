import { join } from "node:path";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const cliPath = join(import.meta.dir, "..", "..", "dist", "cli.js");

export async function runCli(
  args: string[],
  opts: { env?: Record<string, string> } = {},
): Promise<CliResult> {
  const proc = Bun.spawn({
    cmd: [process.execPath, cliPath, ...args],
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
