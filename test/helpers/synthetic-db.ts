import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface SyntheticDb {
  dir: string;
  dbPath: string;
  insertSession(session: { id: string; projectId: string; directory: string; path?: string }): void;
  insertProject(project: { id: string; worktree?: string; sandboxes?: string }): void;
  insertProjectDirectory(entry: { id: string; projectId: string; directory: string }): void;
  insertWorkspace(workspace: { id: string; directory: string }): void;
  query(sql: string): unknown[];
  close(): void;
}

export function createSyntheticDb(): SyntheticDb {
  const dir = mkdtempSync(join(tmpdir(), "oc-relocate-test-"));
  const dbPath = join(dir, "opencode.db");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      directory TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      worktree TEXT,
      sandboxes TEXT
    );
    CREATE TABLE project_directory (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      directory TEXT NOT NULL
    );
    CREATE TABLE workspace (
      id TEXT PRIMARY KEY,
      directory TEXT NOT NULL
    );
  `);

  return {
    dir,
    dbPath,
    insertSession({ id, projectId, directory, path = "" }) {
      db.run(`INSERT INTO session (id, project_id, directory, path) VALUES (?, ?, ?, ?)`, [
        id,
        projectId,
        directory,
        path,
      ]);
    },
    insertProject({ id, worktree = null, sandboxes = null }) {
      db.run(`INSERT INTO project (id, worktree, sandboxes) VALUES (?, ?, ?)`, [id, worktree, sandboxes]);
    },
    insertProjectDirectory({ id, projectId, directory }) {
      db.run(`INSERT INTO project_directory (id, project_id, directory) VALUES (?, ?, ?)`, [
        id,
        projectId,
        directory,
      ]);
    },
    insertWorkspace({ id, directory }) {
      db.run(`INSERT INTO workspace (id, directory) VALUES (?, ?)`, [id, directory]);
    },
    query(sql) {
      return db.query(sql).all();
    },
    close() {
      db.close();
    },
  };
}
