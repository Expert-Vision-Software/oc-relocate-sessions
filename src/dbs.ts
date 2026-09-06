import type { DbCommandOptions } from "./options.js";
import type { Resolution } from "./resolve.js";
import { discoverDbCandidates, opencodeDataDir, resolveGlobalDb } from "./resolve.js";
import { formatBytes } from "./format.js";
import { writeOut } from "./output.js";

export async function runDbs(opts: DbCommandOptions): Promise<number> {
  const resolution = resolveGlobalDb(opts.dbFlag);
  const candidates = discoverDbCandidates();
  const dataDir = opencodeDataDir();

  if (opts.json) {
    writeOut(
      `${JSON.stringify({ dataDir, resolved: resolution, candidates }, null, 2)}\n`,
    );
    return 0;
  }

  const lines: string[] = [];
  if (candidates.length === 0) {
    lines.push(`No Global DB candidates found in ${dataDir}.`, "");
  } else {
    lines.push(`Global DB candidates in ${dataDir}:`, "");
    for (const candidate of candidates) {
      const mark = candidate.path === resolution.path ? "* " : "  ";
      lines.push(`${mark}${candidate.path}`);
      lines.push(
        `    channel=${candidate.channel}  modified=${candidate.mtime}  size=${formatBytes(candidate.sizeBytes)}  wal=${formatBytes(candidate.walBytes)}`,
      );
    }
    lines.push("");
  }
  lines.push(`Resolved Global DB: ${resolution.path} (${sourceLabel(resolution)})`);
  writeOut(`${lines.join("\n")}\n`);
  return 0;
}

function sourceLabel(resolution: Resolution): string {
  if (resolution.source === "flag") return "--db";
  if (resolution.source === "env") return "via OPENCODE_DB";
  return "newest channel match";
}
