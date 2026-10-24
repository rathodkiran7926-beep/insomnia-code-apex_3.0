import { randomUUID } from "node:crypto";
import { z } from "zod";
import { snapshot, listQuery, scopeQuery } from "./checkpoints.js";
import {
  handoffInput,
  handoffSelection,
  buildHandoffPreview,
  bounded,
  fail,
} from "./handoffContext.js";
export { listQuery, scopeQuery };
export const handoffId = z.uuid();
export const createHandoffRequest = z
  .object({
    requestId: z.uuid(),
    input: handoffInput,
    selection: handoffSelection,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export function migrateHandoffs(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS context_handoffs(id TEXT PRIMARY KEY,schema_version INTEGER NOT NULL CHECK(schema_version=1),repository_identity TEXT NOT NULL,snapshot_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,context_json TEXT NOT NULL,markdown TEXT NOT NULL,digest TEXT NOT NULL,request_id TEXT NOT NULL UNIQUE,request_json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS context_handoffs_repository_created ON context_handoffs(repository_identity,created_at DESC,id DESC);`);
}
const record = (r) => ({
  id: r.id,
  schemaVersion: 1,
  status: "ready",
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  context: JSON.parse(r.context_json),
  markdown: r.markdown,
  digest: r.digest,
});
const transaction = (db, fn) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
};
export function createHandoff(db, request) {
  bounded(request, 24 * 1024);
  const p = createHandoffRequest.parse(request);
  return transaction(db, () => {
    const serialized = JSON.stringify(p),
      existing = db
        .prepare("SELECT * FROM context_handoffs WHERE request_id=?")
        .get(p.requestId);
    if (existing) {
      if (existing.request_json !== serialized)
        fail(409, "Request ID already used with different handoff data");
      return { created: false, handoff: record(existing) };
    }
    const preview = buildHandoffPreview(db, {
      input: p.input,
      selection: p.selection,
    });
    if (preview.digest !== p.digest)
      fail(
        409,
        "Handoff preview changed; review a fresh preview before saving",
      );
    const id = randomUUID(),
      now = new Date().toISOString();
    db.prepare(
      "INSERT INTO context_handoffs VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      1,
      preview.context.repositoryIdentity,
      p.input.snapshotId,
      now,
      now,
      JSON.stringify(preview.context),
      preview.markdown,
      preview.digest,
      p.requestId,
      serialized,
    );
    return {
      created: true,
      handoff: record(
        db.prepare("SELECT * FROM context_handoffs WHERE id=?").get(id),
      ),
    };
  });
}
export function listHandoffs(db, query) {
  const { snapshotId, limit, offset } = listQuery.parse(query),
    s = snapshot(db, snapshotId),
    rows = db
      .prepare(
        "SELECT id,snapshot_id,created_at,json_extract(context_json,'$.question') AS question,json_extract(context_json,'$.indexedCommit') AS indexed_commit FROM context_handoffs WHERE repository_identity=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
      )
      .all(s.repositoryIdentity, limit + 1, offset);
  return bounded(
    {
      repositoryIdentity: s.repositoryIdentity,
      items: rows
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          question: r.question,
          snapshotId: r.snapshot_id,
          indexedCommit: r.indexed_commit,
          createdAt: r.created_at,
          status: "ready",
        })),
      limit,
      offset,
      hasMore: rows.length > limit,
    },
    256 * 1024,
  );
}
export function getHandoff(db, id, snapshotId) {
  const s = snapshot(db, snapshotId),
    r = db.prepare("SELECT * FROM context_handoffs WHERE id=?").get(id);
  if (!r) fail(404, "Handoff not found");
  if (r.repository_identity !== s.repositoryIdentity)
    fail(409, "Handoff belongs to a different repository");
  return bounded(record(r), 256 * 1024);
}
export function deleteHandoff(db, id, snapshotId) {
  return transaction(db, () => {
    getHandoff(db, id, snapshotId);
    db.prepare("DELETE FROM context_handoffs WHERE id=?").run(id);
    return { id, deleted: true };
  });
}
