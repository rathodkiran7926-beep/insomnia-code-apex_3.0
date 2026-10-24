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
CREATE TABLE IF NOT EXISTS generated_guides (snapshot_id TEXT NOT NULL, cache_key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,cache_key));
CREATE TABLE IF NOT EXISTS decision_memory_records (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  status TEXT NOT NULL,
  current_revision INTEGER NOT NULL,
  supersedes_id TEXT,
  superseded_by TEXT,
  withdrawn_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS decision_memory_records_repository_status
  ON decision_memory_records(repository_id,status,record_type);
CREATE TABLE IF NOT EXISTS decision_memory_revisions (
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  submitted_by TEXT,
  created_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  PRIMARY KEY(record_id,revision)
);
CREATE TABLE IF NOT EXISTS decision_memory_questions (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  data_json TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL,
  resolved_record_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS decision_memory_open_question_fingerprint
  ON decision_memory_questions(repository_id,fingerprint) WHERE status='open';
CREATE TABLE IF NOT EXISTS decision_memory_question_occurrences (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  origin TEXT,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decision_memory_question_attachments (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by TEXT,
  created_at TEXT NOT NULL,
  content BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS decision_memory_question_attachments_question
  ON decision_memory_question_attachments(question_id,created_at);
CREATE TABLE IF NOT EXISTS decision_memory_audit (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  record_id TEXT,
  question_id TEXT,
  revision INTEGER,
  actor_id TEXT,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS decision_memory_audit_record
  ON decision_memory_audit(record_id,created_at);`);
export function saveSnapshot(graph, docs, markdown, files = {}) {
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
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
