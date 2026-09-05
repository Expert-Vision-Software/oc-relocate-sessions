import { copyFileSync, mkdirSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FakeHome {
  home: string;
  dataDir: string;
  env: Record<string, string>;
}

export function createFakeHome(): FakeHome {
  const home = mkdtempSync(join(tmpdir(), "oc-relocate-home-"));
  const dataDir = join(home, ".local", "share", "opencode");
  mkdirSync(dataDir, { recursive: true });
  return { home, dataDir, env: { HOME: home, USERPROFILE: home } };
}

export function installDb(sourcePath: string, dataDir: string, filename: string, mtime?: Date): string {
  const target = join(dataDir, filename);
  copyFileSync(sourcePath, target);
  if (mtime !== undefined) {
    utimesSync(target, mtime, mtime);
  }
  return target;
}
