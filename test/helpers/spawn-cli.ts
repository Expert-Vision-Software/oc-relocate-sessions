import { join } from "node:path";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface InteractiveStep {
  after: string;
  data: string;
}

const cliPath = join(import.meta.dir, "..", "..", "dist", "cli.js");

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`interactive CLI step timed out waiting for: ${label}`);
}

export async function runCliInteractive(
  args: string[],
  opts: { env?: Record<string, string>; script: InteractiveStep[]; timeoutMs?: number } = { script: [] },
): Promise<CliResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const proc = Bun.spawn({
    cmd: [process.execPath, cliPath, ...args],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...opts.env },
  });

  let stdout = "";
  let stderr = "";
  const pumpStdout = (async () => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }
  })();
  const pumpStderr = (async () => {
    stderr = await new Response(proc.stderr).text();
  })();

  for (const step of opts.script) {
    await waitFor(() => stdout.includes(step.after), timeoutMs, step.after);
    try {
      proc.stdin.write(step.data);
    } catch {
      break;
    }
  }
  proc.stdin.end();

  const exitCode = await proc.exited;
  await Promise.all([pumpStdout, pumpStderr]);
  return { exitCode, stdout, stderr };
}

export async function runCli(
  args: string[],
  opts: { env?: Record<string, string>; runtime?: "default" | "node"; cwd?: string; stdin?: string } = {},
): Promise<CliResult> {
  const bin = opts.runtime === "node" ? (Bun.which("node") ?? "node") : process.execPath;
  const proc = Bun.spawn({
    cmd: [bin, cliPath, ...args],
    cwd: opts.cwd,
    stdin: opts.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...opts.env },
  });

  if (opts.stdin !== undefined && proc.stdin) {
    proc.stdin.write(opts.stdin);
    proc.stdin.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}
