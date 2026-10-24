import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const directory = fileURLToPath(new URL("../data/", import.meta.url));
mkdirSync(directory, { recursive: true });
export const db = new DatabaseSync(
  process.env.DATABASE_PATH || directory + "/mentor.sqlite",
);
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS repositories (id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, commit_sha TEXT NOT NULL, graph_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS components (id TEXT, snapshot_id TEXT, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,id));
CREATE TABLE IF NOT EXISTS relationships (id TEXT, snapshot_id TEXT, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,id));
CREATE TABLE IF NOT EXISTS source_references (id TEXT, snapshot_id TEXT, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,id));
CREATE TABLE IF NOT EXISTS analysis_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, progress INTEGER NOT NULL, message TEXT, snapshot_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documentation (snapshot_id TEXT PRIMARY KEY, data TEXT NOT NULL, markdown TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_files (snapshot_id TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY(snapshot_id,path));
CREATE TABLE IF NOT EXISTS generated_guides (snapshot_id TEXT NOT NULL, cache_key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,cache_key));`);
db.exec(
  "CREATE TABLE IF NOT EXISTS snapshot_setup_metadata (snapshot_id TEXT PRIMARY KEY,data TEXT NOT NULL)",
);
export function saveSnapshot(graph, docs, markdown, files = {}, setupMetadata) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT OR IGNORE INTO repositories VALUES (?,?)").run(
      graph.repository,
      graph.repository,
    );
    db.prepare("INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?)").run(
      graph.snapshotId,
      graph.repository,
      graph.commit,
      JSON.stringify(graph),
    );
    for (const [table, rows] of [
      ["components", graph.components],
      ["relationships", graph.relationships],
      ["source_references", graph.references],
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE snapshot_id=?`).run(
        graph.snapshotId,
      );
      const insert = db.prepare(`INSERT INTO ${table} VALUES (?,?,?)`);
      for (const row of rows)
        insert.run(row.id, graph.snapshotId, JSON.stringify(row));
    }
    db.prepare("INSERT OR REPLACE INTO documentation VALUES (?,?,?)").run(
      graph.snapshotId,
      JSON.stringify(docs),
      markdown,
    );
    const sourceInsert = db.prepare(
      "INSERT OR REPLACE INTO source_files VALUES (?,?,?)",
    );
    const allowed = new Set(graph.references.map((r) => r.file));
    for (const [path, content] of Object.entries(files)) {
      if (
        allowed.has(path) ||
        /(?:^|\/)(package\.json|README\.md)$/i.test(path)
      )
        sourceInsert.run(graph.snapshotId, path, content);
    }
    if (setupMetadata)
      db.prepare(
        "INSERT OR REPLACE INTO snapshot_setup_metadata VALUES (?,?)",
      ).run(graph.snapshotId, JSON.stringify(setupMetadata));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
