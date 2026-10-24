import { db } from "./storage.js";

// Additive, idempotent migration. Existing analysis and mentor data are untouched.
db.exec(`
CREATE TABLE IF NOT EXISTS collaboration_users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collaboration_workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collaboration_members (
  workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('maintainer','reviewer','developer')),
  PRIMARY KEY(workspace_id,user_id), FOREIGN KEY(workspace_id) REFERENCES collaboration_workspaces(id), FOREIGN KEY(user_id) REFERENCES collaboration_users(id));
CREATE TABLE IF NOT EXISTS collaboration_auth_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES collaboration_users(id));
CREATE TABLE IF NOT EXISTS collaboration_invites (
  token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('reviewer','developer')),
  created_by TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at TEXT);
CREATE TABLE IF NOT EXISTS collaboration_repositories (
  workspace_id TEXT NOT NULL, repository_id TEXT NOT NULL, PRIMARY KEY(workspace_id,repository_id));
CREATE TABLE IF NOT EXISTS handoff_sessions (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, repository_id TEXT NOT NULL, created_by TEXT NOT NULL, assigned_to TEXT,
  title TEXT NOT NULL, question TEXT NOT NULL, expected_behavior TEXT NOT NULL, actual_behavior TEXT NOT NULL,
  attempted_solutions TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('OPEN','IN_REVIEW','NEEDS_CONTEXT','RESOLVED','CLOSED')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT,
  FOREIGN KEY(workspace_id) REFERENCES collaboration_workspaces(id), FOREIGN KEY(created_by) REFERENCES collaboration_users(id));
CREATE TABLE IF NOT EXISTS handoff_snapshots (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, analysis_snapshot_id TEXT NOT NULL, component_id TEXT,
  reference_id TEXT NOT NULL, file_path TEXT NOT NULL, function_name TEXT, start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL, source_code TEXT NOT NULL, commit_sha TEXT NOT NULL, branch_name TEXT,
  source_url TEXT NOT NULL, context_json TEXT NOT NULL, ai_summary TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES handoff_sessions(id));
CREATE TABLE IF NOT EXISTS handoff_comments (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, author_id TEXT NOT NULL,
  content TEXT NOT NULL, line_start INTEGER, line_end INTEGER, kind TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES handoff_sessions(id), FOREIGN KEY(snapshot_id) REFERENCES handoff_snapshots(id));
CREATE TABLE IF NOT EXISTS handoff_activity (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, actor_id TEXT NOT NULL, event_type TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES handoff_sessions(id));
CREATE TABLE IF NOT EXISTS handoff_resolutions (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, proposed_by TEXT NOT NULL, confirmed_by TEXT,
  solution TEXT NOT NULL, explanation TEXT NOT NULL, approved_for_knowledge INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT, created_at TEXT NOT NULL, confirmed_at TEXT,
  FOREIGN KEY(session_id) REFERENCES handoff_sessions(id));
CREATE INDEX IF NOT EXISTS handoff_session_workspace_activity ON handoff_sessions(workspace_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS handoff_comment_session ON handoff_comments(session_id,created_at,id);
CREATE INDEX IF NOT EXISTS handoff_activity_session ON handoff_activity(session_id,created_at);
CREATE INDEX IF NOT EXISTS handoff_resolution_session ON handoff_resolutions(session_id,created_at);
CREATE TABLE IF NOT EXISTS handoff_repository_views (
  analysis_snapshot_id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, commit_sha TEXT NOT NULL,
  graph_json TEXT NOT NULL, coverage_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS handoff_repository_files (
  analysis_snapshot_id TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, redacted INTEGER NOT NULL,
  PRIMARY KEY(analysis_snapshot_id,path), FOREIGN KEY(analysis_snapshot_id) REFERENCES handoff_repository_views(analysis_snapshot_id));
CREATE TRIGGER IF NOT EXISTS immutable_handoff_repository BEFORE UPDATE ON handoff_repository_views
  BEGIN SELECT RAISE(ABORT,'Shared repository evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_handoff_repository_file BEFORE UPDATE ON handoff_repository_files
  BEGIN SELECT RAISE(ABORT,'Shared repository source is immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_handoff_source BEFORE UPDATE OF
  session_id,analysis_snapshot_id,component_id,reference_id,file_path,function_name,start_line,end_line,source_code,commit_sha,branch_name,source_url,context_json
  ON handoff_snapshots BEGIN SELECT RAISE(ABORT,'Handoff source evidence is immutable'); END;
`);

export function transaction(work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export { db };
