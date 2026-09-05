import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";

export interface Row {
  id: string;
  directory: string;
}

export function queryRows<T = Record<string, unknown>>(dbPath: string, sql: string): T[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query(sql).all() as unknown as T[];
  } finally {
    db.close();
  }
}

export function sessionRows(dbPath: string): Row[] {
  return queryRows<{ id: string; directory: string }>(
    dbPath,
    "SELECT id, directory FROM session ORDER BY id ASC",
  );
}

export function backupFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes(".bak-relocate-"));
}
