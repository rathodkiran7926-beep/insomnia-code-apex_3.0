import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validateExplanations } from "./documentation.js";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const graphDigest = ({ branch, revision, ...facts }) => digest(JSON.stringify(facts));
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
db.exec("CREATE TABLE IF NOT EXISTS analysis_snapshot_manifests (snapshot_id TEXT PRIMARY KEY,data TEXT NOT NULL)");

function validDocumentation(row, graph) {
  try {
    const docs = JSON.parse(row.data);
    if (docs.snapshotId !== graph.snapshotId || !row.markdown?.trim() ||
      !["available", "unavailable", "failed"].includes(docs.ai?.status)) return false;
    validateExplanations({ explanations: docs.ai.explanations }, graph);
    return true;
  } catch { return false; }
}

export function reusableSnapshot(repository, commit, versions) {
  const row = db.prepare("SELECT * FROM snapshots WHERE repository_id=? AND commit_sha=?").get(repository, commit);
  if (!row) return null;
  const saved = db.prepare("SELECT data FROM analysis_snapshot_manifests WHERE snapshot_id=?").get(row.id);
  if (!saved) return null;
  try {
    const manifest = JSON.parse(saved.data);
    const graph = JSON.parse(row.graph_json);
    if (manifest.analyzerVersion !== versions.analyzerVersion || manifest.extractionPolicy !== versions.extractionPolicy ||
      manifest.repository !== repository || manifest.commit !== commit ||
      graph.repository !== repository || graph.commit !== commit || graph.snapshotId !== row.id ||
      row.id !== digest(repository + commit).slice(0, 24) || manifest.graph !== graphDigest(graph) ||
      !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length !== manifest.fileCount) return null;
    const sources = new Map(db.prepare("SELECT path,content FROM source_files WHERE snapshot_id=?").all(row.id)
      .map((file) => [file.path, file.content]));
    if (manifest.files.some(([file, hash]) => !sources.has(file) || digest(sources.get(file)) !== hash)) return null;
    const captured = new Set(manifest.files.map(([file]) => file));
    if (captured.size !== manifest.files.length || graph.references.some((ref) =>
      ref.snapshotId !== row.id || !captured.has(ref.file) ||
      !Number.isInteger(ref.startOffset) || !Number.isInteger(ref.endOffset) ||
      ref.startOffset < 0 || ref.endOffset < ref.startOffset || ref.endOffset > sources.get(ref.file).length ||
      sources.get(ref.file).slice(ref.startOffset, ref.endOffset).slice(0, 1800) !== ref.excerpt)) return null;
    for (const [table, values] of [["components", graph.components], ["relationships", graph.relationships], ["source_references", graph.references]]) {
      const rows = db.prepare(`SELECT id,data FROM ${table} WHERE snapshot_id=?`).all(row.id);
      const expected = new Map(values.map((value) => [value.id, JSON.stringify(value)]));
      if (rows.length !== expected.size || rows.some((item) => expected.get(item.id) !== item.data)) return null;
    }
    const documentation = db.prepare("SELECT data,markdown FROM documentation WHERE snapshot_id=?").get(row.id);
    const setup = db.prepare("SELECT data FROM snapshot_setup_metadata WHERE snapshot_id=?").get(row.id);
    if (!documentation || !validDocumentation(documentation, graph) || !setup || digest(setup.data) !== manifest.setup) return null;
    return graph;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return null;
    throw error;
  }
}

export function saveSnapshot(graph, docs, markdown, files = {}, setupMetadata, analysis) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const previousGraph = db.prepare("SELECT graph_json FROM snapshots WHERE id=?").get(graph.snapshotId);
    if (previousGraph && (analysis || db.prepare("SELECT 1 FROM analysis_snapshot_manifests WHERE snapshot_id=?").get(graph.snapshotId))) {
      const old = JSON.parse(previousGraph.graph_json);
      const identity = (ref) => JSON.stringify([ref.snapshotId, ref.file, ref.startLine, ref.endLine, ref.url, ref.excerpt]);
      const references = new Map(graph.references.map((ref) => [ref.id, ref]));
      const components = new Map(graph.components.map((node) => [node.id, node.referenceId]));
      const edges = new Map(graph.relationships.map((edge) => [edge.id, JSON.stringify([edge.source, edge.target, edge.type, edge.referenceId])]));
      if (old.references.some((ref) => {
        const next = references.get(ref.id);
        return !next || identity(next) !== identity(ref) ||
          ["startOffset", "endOffset"].some((key) => Number.isInteger(ref[key]) && ref[key] !== next[key]);
      }) ||
        old.components.some((node) => components.get(node.id) !== node.referenceId) ||
        old.relationships.some((edge) => edges.get(edge.id) !== JSON.stringify([edge.source, edge.target, edge.type, edge.referenceId])))
        throw Object.assign(new Error("Existing snapshot reference identities differ; an explicit compatibility migration is required before replacement."), { code: "SNAPSHOT_EVIDENCE_CONFLICT" });
    }
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
    const previous = db.prepare("SELECT data,markdown FROM documentation WHERE snapshot_id=?").get(graph.snapshotId);
    const next = { data: JSON.stringify(docs), markdown };
    // PR/source-only saves must not discard already validated commentary.
    const nextValid = validDocumentation(next, graph);
    const freshCommentary = analysis?.complete === true && nextValid && docs.ai.status === "available" && docs.ai.explanations.length > 0;
    const preserve = previous && validDocumentation(previous, graph) &&
      ((!freshCommentary && JSON.parse(previous.data).ai.explanations.length > 0) || !nextValid);
    if (!preserve) db.prepare("INSERT OR REPLACE INTO documentation VALUES (?,?,?)").run(
      graph.snapshotId, next.data, markdown,
    );
    const sourceInsert = db.prepare(
      "INSERT OR REPLACE INTO source_files VALUES (?,?,?)",
    );
    const allowed = new Set(graph.references.map((r) => r.file));
    for (const [path, content] of Object.entries(files)) {
      if (
        analysis?.complete === true ||
        allowed.has(path) ||
        /(?:^|\/)(package\.json|tsconfig\.json|README\.md)$/i.test(path)
      )
        sourceInsert.run(graph.snapshotId, path, content);
    }
    if (setupMetadata)
      db.prepare(
        "INSERT OR REPLACE INTO snapshot_setup_metadata VALUES (?,?)",
      ).run(graph.snapshotId, JSON.stringify(setupMetadata));
    if (analysis) {
      db.prepare("DELETE FROM analysis_snapshot_manifests WHERE snapshot_id=?").run(graph.snapshotId);
      if (analysis.complete === true && setupMetadata && Object.keys(files).length &&
        graph.references.every((ref) => ref.snapshotId === graph.snapshotId && Object.hasOwn(files, ref.file))) {
        const manifest = {
          analyzerVersion: analysis.analyzerVersion, extractionPolicy: analysis.extractionPolicy,
          repository: graph.repository, commit: graph.commit, graph: graphDigest(graph),
          fileCount: Object.keys(files).length,
          files: Object.entries(files).map(([file, content]) => [file, digest(content)]),
          setup: digest(JSON.stringify(setupMetadata)),
        };
        db.prepare("INSERT INTO analysis_snapshot_manifests VALUES (?,?)").run(graph.snapshotId, JSON.stringify(manifest));
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
