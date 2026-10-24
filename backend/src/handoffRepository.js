import { db, transaction } from "./handoffStorage.js";
import { redactCredentials } from "./handoffSafety.js";
import { fail } from "./collaborationAuth.js";

const safePath = (path) =>
  typeof path === "string" &&
  !path.split("/").some((p) => !p || p === "." || p === "..") &&
  !/(?:^|\/)\.env|secret|credential|private.?key|(?:^|\/)(?:\.git|node_modules)\//i.test(
    path,
  );
// A commit gets one immutable, credential-filtered repository copy, shared by its handoffs.
// Never load the developer's currently selected repository or execute repository code.
export function captureHandoffRepository(graph) {
  if (
    db
      .prepare(
        "SELECT 1 FROM handoff_repository_views WHERE analysis_snapshot_id=?",
      )
      .get(graph.snapshotId)
  )
    return;
  const references = graph.references.filter(
    (r) => r.snapshotId === graph.snapshotId && safePath(r.file),
  );
  const knownRefs = new Set(references.map((r) => r.id));
  const components = graph.components.filter((c) =>
    knownRefs.has(c.referenceId),
  );
  const ids = new Set(components.map((c) => c.id));
  const relationships = graph.relationships.filter(
    (r) =>
      ids.has(r.source) && ids.has(r.target) && knownRefs.has(r.referenceId),
  );
  const paths = [...new Set(references.map((r) => r.file))].sort();
  const files = [],
    unavailable = [];
  for (const path of paths) {
    const row = db
      .prepare(
        "SELECT content FROM source_files WHERE snapshot_id=? AND path=?",
      )
      .get(graph.snapshotId, path);
    if (!row || Buffer.byteLength(row.content) > 256000) {
      unavailable.push(path);
      continue;
    }
    const content = redactCredentials(row.content);
    files.push({ path, content, redacted: content !== row.content });
  }
  const savedGraph = {
    snapshotId: graph.snapshotId,
    repository: graph.repository,
    commit: graph.commit,
    components: components.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      inferred: c.inferred,
      referenceId: c.referenceId,
      fullPaths: c.fullPaths,
    })),
    relationships,
    references: references.map(({ excerpt, ...r }) => r),
  };
  const coverage = {
    analyzedFiles: paths.length,
    capturedFiles: files.length,
    unavailable,
    limited: (graph.report?.exclusions?.length || 0) > 0,
    note: "Analyzed source files only. Excluded, sensitive and uncaptured files are not shared. Static diagrams are not runtime traces.",
  };
  transaction(() => {
    db.prepare("INSERT INTO handoff_repository_views VALUES (?,?,?,?,?,?)").run(
      graph.snapshotId,
      graph.repository,
      graph.commit,
      JSON.stringify(savedGraph),
      JSON.stringify(coverage),
      new Date().toISOString(),
    );
    const insert = db.prepare(
      "INSERT INTO handoff_repository_files VALUES (?,?,?,?)",
    );
    for (const file of files)
      insert.run(
        graph.snapshotId,
        file.path,
        file.content,
        Number(file.redacted),
      );
  });
}
function viewFor(snapshot) {
  let row = db
    .prepare(
      "SELECT * FROM handoff_repository_views WHERE analysis_snapshot_id=?",
    )
    .get(snapshot.analysis_snapshot_id);
  if (!row) {
    // Legacy handoffs can gain an explorer from their own stored commit, without a new analysis.
    const stored = db
      .prepare("SELECT graph_json FROM snapshots WHERE id=? AND commit_sha=?")
      .get(snapshot.analysis_snapshot_id, snapshot.commit_sha);
    if (!stored)
      throw fail(
        404,
        "The original repository analysis is unavailable. The selected code remains saved.",
      );
    captureHandoffRepository(JSON.parse(stored.graph_json));
    row = db
      .prepare(
        "SELECT * FROM handoff_repository_views WHERE analysis_snapshot_id=?",
      )
      .get(snapshot.analysis_snapshot_id);
  }
  if (row.commit_sha !== snapshot.commit_sha)
    throw fail(409, "Shared repository commit mismatch.");
  return row;
}
export function handoffRepository(snapshot) {
  const row = viewFor(snapshot);
  return {
    graph: JSON.parse(row.graph_json),
    coverage: JSON.parse(row.coverage_json),
    files: db
      .prepare(
        "SELECT path,redacted FROM handoff_repository_files WHERE analysis_snapshot_id=? ORDER BY path",
      )
      .all(snapshot.analysis_snapshot_id),
  };
}
export function handoffRepositorySource(snapshot, path) {
  viewFor(snapshot);
  if (!safePath(path)) throw fail(400, "Invalid shared source path.");
  const row = db
    .prepare(
      "SELECT content,redacted FROM handoff_repository_files WHERE analysis_snapshot_id=? AND path=?",
    )
    .get(snapshot.analysis_snapshot_id, path);
  if (!row)
    throw fail(404, "This file was not captured in the shared analysis.");
  // Do not claim that a legacy cached file matches the original selection if it does not.
  if (
    path === snapshot.file_path &&
    row.content
      .split("\n")
      .slice(snapshot.start_line - 1, snapshot.end_line)
      .join("\n") !== snapshot.source_code
  )
    throw fail(
      409,
      "The saved full file does not match the original selection. Showing the immutable selected code instead.",
    );
  const repo = db
    .prepare(
      "SELECT repository_id FROM handoff_repository_views WHERE analysis_snapshot_id=?",
    )
    .get(snapshot.analysis_snapshot_id).repository_id;
  return {
    file: path,
    excerpt: row.content,
    startLine: 1,
    endLine: row.content.split("\n").length,
    complete: true,
    redacted: !!row.redacted,
    commit: snapshot.commit_sha,
    snapshotId: snapshot.analysis_snapshot_id,
    url: `${repo}/blob/${snapshot.commit_sha}/${path.split("/").map(encodeURIComponent).join("/")}#L1`,
  };
}
