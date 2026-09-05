import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { CliError } from "./errors.js";
import { formatBytes } from "./format.js";
import { openDatabase, type OpenedDriver } from "./driver.js";

const CHANNEL_PATTERN = /^opencode(?:-(.+))?\.db$/;
export const DEFAULT_CHANNEL = "stable";
export const WAL_WARN_THRESHOLD_BYTES = 1024 * 1024;

export type ResolutionSource = "flag" | "env" | "discovered";

export interface Resolution {
  path: string;
  source: ResolutionSource;
  channel: string;
}

export interface DbCandidate {
  path: string;
  channel: string;
  mtimeMs: number;
  mtime: string;
  sizeBytes: number;
  walBytes: number;
  shmBytes: number;
}

export interface OpenedGlobalDb extends OpenedDriver {
  resolution: Resolution;
}

export function opencodeDataDir(): string {
  return join(homedir(), ".local", "share", "opencode");
}

export function channelForDbFile(filename: string): string | null {
  const match = CHANNEL_PATTERN.exec(basename(filename));
  if (match === null) return null;
  return match[1] ?? DEFAULT_CHANNEL;
}

export function discoverDbCandidates(dataDir: string = opencodeDataDir()): DbCandidate[] {
  if (!existsSync(dataDir)) return [];
  const candidates: DbCandidate[] = [];
  for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const channel = channelForDbFile(entry.name);
    if (channel === null) continue;
    const path = join(dataDir, entry.name);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }
    candidates.push({
      path,
      channel,
      mtimeMs: stats.mtimeMs,
      mtime: new Date(stats.mtimeMs).toISOString(),
      sizeBytes: stats.size,
      walBytes: sidecarBytes(path, "-wal"),
      shmBytes: sidecarBytes(path, "-shm"),
    });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates;
}

export function sidecarBytes(dbPath: string, suffix: string): number {
  try {
    return statSync(dbPath + suffix).size;
  } catch {
    return 0;
  }
}

function rejectMemory(value: string, origin: string): void {
  if (value.trim() !== ":memory:") return;
  throw new CliError(
    `:memory: is not supported — ${origin} must point at an existing Global DB file; oc-relocate never creates a database`,
  );
}

function explicitResolution(
  value: string,
  source: "flag" | "env",
  origin: string,
): Resolution {
  rejectMemory(value, origin);
  return { path: value, source, channel: channelForDbFile(value) ?? "unknown" };
}

export function resolveGlobalDb(flagValue?: string): Resolution {
  if (flagValue !== undefined && flagValue.trim().length > 0) {
    return explicitResolution(flagValue, "flag", "--db");
  }
  const envValue = process.env.OPENCODE_DB;
  if (envValue !== undefined && envValue.trim().length > 0) {
    return explicitResolution(envValue, "env", "OPENCODE_DB");
  }
  const newest = discoverDbCandidates()[0];
  if (newest === undefined) {
    throw new CliError(
      `no Global DB found in ${opencodeDataDir()} — pass --db <path>, set OPENCODE_DB, or install opencode first`,
    );
  }
  return { path: newest.path, source: "discovered", channel: newest.channel };
}

export async function openGlobalDb(resolution: Resolution): Promise<OpenedGlobalDb> {
  if (!existsSync(resolution.path) || !statSync(resolution.path).isFile()) {
    throw new CliError(
      `Global DB not found: ${resolution.path} — run 'oc-relocate dbs' to list candidates; oc-relocate never creates a database`,
    );
  }
  const opened = await openDatabase(resolution.path, { readonly: true });
  return { ...opened, resolution };
}

export async function openResolvedDb(dbFlag: string | undefined): Promise<OpenedGlobalDb> {
  const opened = await openGlobalDb(resolveGlobalDb(dbFlag));
  const warning = walWarning(opened.resolution.path);
  if (warning !== null) {
    process.stderr.write(`${warning}\n`);
  }
  return opened;
}

export function walWarning(dbPath: string, threshold: number = WAL_WARN_THRESHOLD_BYTES): string | null {
  const walBytes = sidecarBytes(dbPath, "-wal");
  if (walBytes < threshold) return null;
  return (
    `warning: WAL sidecar is large (${formatBytes(walBytes)}) at ${dbPath}-wal — recent opencode writes may still sit ` +
    `in the WAL; quit opencode cleanly so the database is complete`
  );
}

export function walSidecarAdvisory(dbPath: string): string | null {
  const walBytes = sidecarBytes(dbPath, "-wal");
  if (walBytes <= 0) return null;
  return (
    `warning: WAL sidecar present (${formatBytes(walBytes)}) at ${dbPath}-wal — recent opencode writes may still ` +
    `sit in the WAL; quit opencode cleanly first so the backup is complete`
  );
}
