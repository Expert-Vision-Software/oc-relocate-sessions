import { CliError } from "./errors.js";
import type { Database } from "bun:sqlite";
import type { DatabaseSync } from "node:sqlite";

export interface DriverRunResult {
  changes: number | bigint;
}

export interface DriverDb {
  run(sql: string, params?: unknown[]): DriverRunResult;
  all(sql: string, params?: unknown[]): unknown[];
  exec(sql: string): void;
  close(): void;
}

export interface OpenedDriver {
  db: DriverDb;
  driver: "bun:sqlite" | "node:sqlite";
}

const MIN_NODE_MAJOR = 24;

export function nodeMajorVersion(): number {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
}

function requireSupportedNode(): void {
  if (nodeMajorVersion() >= MIN_NODE_MAJOR) return;
  throw new CliError(
    `oc-relocate needs Node >= ${MIN_NODE_MAJOR} for the built-in SQLite driver (found v${process.versions.node}). ` +
      `Run with Bun instead: bunx oc-relocate`,
  );
}

export async function openDatabase(path: string, opts: { readonly: boolean }): Promise<OpenedDriver> {
  if (typeof Bun !== "undefined") {
    const { Database } = await import("bun:sqlite");
    return { db: wrapBunDb(new Database(path, { readonly: opts.readonly, create: false })), driver: "bun:sqlite" };
  }
  requireSupportedNode();
  const { DatabaseSync } = await import("node:sqlite");
  return { db: wrapNodeDb(new DatabaseSync(path, { readOnly: opts.readonly })), driver: "node:sqlite" };
}

function wrapBunDb(db: InstanceType<typeof Database>): DriverDb {
  return {
    run(sql, params = []) {
      return db.query(sql).run(...(params as never[]));
    },
    all(sql, params = []) {
      return db.query(sql).all(...(params as never[])) as unknown[];
    },
    exec(sql) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
  };
}

function wrapNodeDb(db: InstanceType<typeof DatabaseSync>): DriverDb {
  return {
    run(sql, params = []) {
      return db.prepare(sql).run(...params);
    },
    all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    exec(sql) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
  };
}
