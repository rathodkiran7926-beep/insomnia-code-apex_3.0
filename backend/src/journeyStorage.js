import { db } from "./storage.js";
db.exec(`
CREATE TABLE IF NOT EXISTS runtime_scenarios (id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runtime_recipe_sources (snapshot_id TEXT PRIMARY KEY, journey_id TEXT NOT NULL, source_hash TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runtime_traces (id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, user_id TEXT NOT NULL, mode TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trace_events (id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, sequence INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(trace_id,sequence));
CREATE TABLE IF NOT EXISTS event_source_links (event_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, source_ref_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS playback_checkpoints (user_id TEXT NOT NULL, journey_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,journey_id));
CREATE TABLE IF NOT EXISTS journey_questions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, trace_id TEXT NOT NULL, event_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS runtime_trace_owner ON runtime_traces(user_id,scenario_id,created_at DESC);
CREATE TABLE IF NOT EXISTS journey_explanation_artifacts (cache_key TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
`);
export { db };
