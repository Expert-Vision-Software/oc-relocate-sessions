import { existsSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { CliError } from "./errors.js";

export interface NormalizedRelocationPaths {
  from: string;
  to: string;
  toExists: boolean;
}

const DRIVE_ROOT = /^[A-Za-z]:$/;
const DRIVE_ABSOLUTE = /^[A-Za-z]:\//;

export function normalizeRelocationPaths(
  fromRaw: string,
  toRaw: string,
  cwd: string = process.cwd(),
): NormalizedRelocationPaths {
  const from = normalizePathInput(fromRaw, cwd);
  const to = normalizePathInput(toRaw, cwd);
  if (from === to) {
    throw new CliError(`--from and --to are the same path (${from}) — nothing to relocate`);
  }
  return { from, to, toExists: existsSync(to) };
}

export function normalizePathInput(raw: string, cwd: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new CliError("path must not be empty");
  }
  return stripTrailingSlash(toForwardSlashes(absolutize(toForwardSlashes(trimmed), cwd)));
}

function absolutize(slashed: string, cwd: string): string {
  if (isAbsolute(slashed) || DRIVE_ABSOLUTE.test(slashed)) return slashed;
  return resolve(cwd, slashed);
}

function toForwardSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function stripTrailingSlash(value: string): string {
  if (!value.endsWith("/") || value.length === 1) return value;
  const stripped = value.replace(/\/+$/, "");
  if (stripped.length === 0) return "/";
  return DRIVE_ROOT.test(stripped) ? `${stripped}/` : stripped;
}

export function displayPath(value: string): string {
  return sep === "/" ? value : value.replaceAll("/", sep);
}
