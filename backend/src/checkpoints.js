import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRepository } from './github.js';

const id = z.string().min(1).max(150).regex(/^[\w-]+$/);
export const checkpointId = z.uuid();
// Keep exact editing whitespace while rejecting binary/terminal controls that
// cannot round-trip safely through the extension and handoff authored fields.
const authoredText = max => z.string().max(max).refine(s => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(s));
export const localContext = z.object({ branch: authoredText(200).refine(s => s.length > 0).optional(), headCommit: z.string().regex(/^[a-fA-F0-9]{40}$/).optional(), gitStatus: z.enum(['clean', 'modified', 'unknown']) }).strict();
export const createRequest = z.object({ requestId: z.uuid(), snapshotId: id, taskTitle: authoredText(200).refine(s => s.trim().length > 0), notes: z.object({ discovery: authoredText(2000), unresolved: authoredText(2000), nextStep: authoredText(2000) }).strict(), localContext, sourceReferenceIds: z.array(z.string().min(1).max(200)).max(8).refine(a => new Set(a).size === a.length) }).strict();
export const scopeQuery = z.object({ snapshotId: id }).strict();
export const listQuery = z.object({ snapshotId: id, limit: z.coerce.number().int().min(1).max(25).default(10), offset: z.coerce.number().int().min(0).max(10000).default(0) }).strict();
export const resumeRequest = z.object({ currentSnapshotId: id, localContext }).strict();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const canonical = value => parseRepository(value).url.toLowerCase();
export function migrateCheckpoints(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS task_checkpoints (
    id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL CHECK(schema_version=1),
    repository_identity TEXT NOT NULL, snapshot_id TEXT NOT NULL, indexed_commit TEXT NOT NULL,
    task_title TEXT NOT NULL, notes_json TEXT NOT NULL, local_context_json TEXT NOT NULL,
    source_reference_ids_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE, request_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS task_checkpoints_repository_created ON task_checkpoints(repository_identity,created_at DESC,id DESC);`);
  checkpointOwnershipMigration(db);
}
export function checkpointOwnershipMigration(db) {
  if (!db.prepare('PRAGMA table_info(task_checkpoints)').all().some(c => c.name === 'user_id')) db.exec('ALTER TABLE task_checkpoints ADD COLUMN user_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS task_checkpoints_user_repository ON task_checkpoints(user_id,repository_identity)');
}
export function snapshot(db, snapshotId) {
  const s = db.prepare("SELECT id,repository_id,commit_sha,json_extract(graph_json,'$.report.limitations') AS limitations FROM snapshots WHERE id=?").get(snapshotId);
  if (!s) fail(404, 'Snapshot not found');
  if (!/^[a-fA-F0-9]{40}$/.test(s.commit_sha)) fail(409, 'Snapshot has no immutable indexed commit');
  return { snapshotId: s.id, repositoryIdentity: canonical(s.repository_id), indexedCommit: s.commit_sha, limitations: JSON.parse(s.limitations || '[]').filter(v => typeof v === 'string').slice(0, 30).map(s => s.slice(0, 500)) };
}
function record(row) {
  return { id: row.id, schemaVersion: row.schema_version, repositoryIdentity: row.repository_identity, snapshotId: row.snapshot_id, indexedCommit: row.indexed_commit, taskTitle: row.task_title, notes: JSON.parse(row.notes_json), localContext: JSON.parse(row.local_context_json), sourceReferenceIds: JSON.parse(row.source_reference_ids_json), createdAt: row.created_at, updatedAt: row.updated_at };
}
function read(db, checkpointId, userId = null) {
  const row = db.prepare('SELECT * FROM task_checkpoints WHERE id=? AND user_id IS ?').get(checkpointId, userId);
  if (!row) fail(404, 'Checkpoint not found'); return record(row);
}
function scoped(db, checkpointId, snapshotId, userId = null) {
  const current = snapshot(db, snapshotId), saved = read(db, checkpointId, userId);
  if (saved.repositoryIdentity !== current.repositoryIdentity) fail(409, 'Checkpoint belongs to a different repository');
  return { saved, current };
}
export function reference(db, snap, referenceId) {
  const row = db.prepare('SELECT data FROM source_references WHERE snapshot_id=? AND id=?').get(snap.snapshotId, referenceId);
  if (!row) return;
  const r = JSON.parse(row.data);
  if (r.id !== referenceId || r.snapshotId !== snap.snapshotId || typeof r.file !== 'string' || r.file.length > 1000 || !r.file || /[\\\x00-\x1f]/.test(r.file) || r.file.startsWith('/') || r.file.split('/').some(p => p === '.' || p === '..' || !p) || /^[A-Za-z]:/.test(r.file) || !Number.isSafeInteger(r.startLine) || !Number.isSafeInteger(r.endLine) || r.startLine < 1 || r.endLine < r.startLine || r.endLine > 1000000 || typeof r.url !== 'string' || r.url.length > 3000) return;
  try {
    const u = new URL(r.url);
    const expected = new URL(`${snap.repositoryIdentity}/blob/${snap.indexedCommit}/${r.file.split('/').map(encodeURIComponent).join('/')}#L${r.startLine}-L${r.endLine}`);
    // Keep parity with the extension citation validator: repository casing is
    // insensitive, while commit, escaped file path and line fragment are exact.
    const path = u.pathname.split('/').map((part, i) => i === 1 || i === 2 ? part.toLowerCase() : part).join('/');
    if (u.origin !== 'https://github.com' || u.username || u.password || u.search || path !== expected.pathname || u.hash !== expected.hash) return;
  } catch { return; }
  return { id: r.id, snapshotId: r.snapshotId, file: r.file, startLine: r.startLine, endLine: r.endLine, url: r.url };
}
function detail(db, checkpoint) {
  const warnings = [], references = [], components = [];
  const exists = db.prepare('SELECT id FROM snapshots WHERE id=?').get(checkpoint.snapshotId);
  if (exists) {
    const snap = snapshot(db, checkpoint.snapshotId);
    if (snap.repositoryIdentity === checkpoint.repositoryIdentity && snap.indexedCommit === checkpoint.indexedCommit) {
      for (const refId of checkpoint.sourceReferenceIds) {
        const r = reference(db, snap, refId); if (r) references.push(r); else warnings.push('Saved source evidence is unavailable.');
      }
      if (references.length) {
        const selected = new Set(references.map(r => r.id));
        const rows = db.prepare(`SELECT id,data FROM components WHERE snapshot_id=? AND json_extract(data,'$.referenceId') IN (${references.map(() => '?').join(',')}) ORDER BY id LIMIT 20`).all(checkpoint.snapshotId, ...selected);
        for (const row of rows) {
          const c = JSON.parse(row.data);
          if (c.id === row.id && selected.has(c.referenceId) && [c.id, c.name, c.role].every(x => typeof x === 'string' && x.length > 0 && x.length <= 300)) components.push({ id: c.id, name: c.name, role: c.role, referenceId: c.referenceId });
        }
      }
    } else warnings.push('Saved snapshot identity has changed; source evidence is unavailable.');
  } else warnings.push('Saved snapshot is unavailable. Your recorded notes are preserved.');
  return { checkpoint, snapshotAvailable: !!exists && warnings.every(w => !w.includes('identity')), references, components, warnings };
}
function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE'); try { const result = work(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function createCheckpoint(db, input, userId = null) {
  const p = createRequest.parse(input);
  if (Buffer.byteLength(JSON.stringify(input)) > 24 * 1024) fail(413, 'Checkpoint exceeds request limit');
  return transaction(db, () => {
    // Construct a stable serialization independent of incoming JSON key order.
    const request = JSON.stringify(p), existing = db.prepare('SELECT * FROM task_checkpoints WHERE request_id=?').get(p.requestId);
    if (existing) { if ((existing.user_id ?? null) !== userId) fail(404, 'Checkpoint not found'); if (existing.request_json !== request) fail(409, 'Request ID was already used with different checkpoint data'); return { created: false, detail: detail(db, record(existing)) }; }
    const s = snapshot(db, p.snapshotId);
    for (const ref of p.sourceReferenceIds) if (!reference(db, s, ref)) fail(400, 'Source reference does not belong to the saved snapshot');
    const checkpointId = randomUUID(), now = new Date().toISOString();
    db.prepare('INSERT INTO task_checkpoints (id,schema_version,repository_identity,snapshot_id,indexed_commit,task_title,notes_json,local_context_json,source_reference_ids_json,created_at,updated_at,request_id,request_json,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(checkpointId, 1, s.repositoryIdentity, p.snapshotId, s.indexedCommit, p.taskTitle, JSON.stringify(p.notes), JSON.stringify(p.localContext), JSON.stringify(p.sourceReferenceIds), now, now, p.requestId, request, userId);
    return { created: true, detail: detail(db, read(db, checkpointId, userId)) };
  });
}
export function listCheckpoints(db, query, userId = null) {
  const { snapshotId, limit, offset } = listQuery.parse(query), s = snapshot(db, snapshotId);
  const rows = db.prepare('SELECT id,schema_version,repository_identity,snapshot_id,indexed_commit,task_title,local_context_json,created_at,updated_at FROM task_checkpoints WHERE repository_identity=? AND user_id IS ? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(s.repositoryIdentity, userId, limit + 1, offset);
  const items = rows.slice(0, limit).map(r => { const { notes, sourceReferenceIds, ...summary } = record({ ...r, notes_json: '{}', source_reference_ids_json: '[]' }); return summary; });
  return { repositoryIdentity: s.repositoryIdentity, items, limit, offset, hasMore: rows.length > limit };
}
export function getCheckpoint(db, checkpointId, snapshotId, userId = null) { return detail(db, scoped(db, checkpointId, snapshotId, userId).saved); }
export function deleteCheckpoint(db, checkpointId, snapshotId, userId = null) {
  return transaction(db, () => { scoped(db, checkpointId, snapshotId, userId); db.prepare('DELETE FROM task_checkpoints WHERE id=?').run(checkpointId); return { id: checkpointId, deleted: true }; });
}
function existingComparison(db, saved, current) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pr_comparisons'").get()) return;
  const rows = db.prepare('SELECT id,data FROM pr_comparisons WHERE base_snapshot_id=? AND head_snapshot_id=? ORDER BY id LIMIT 10').all(saved.snapshotId, current.snapshotId);
  for (const row of rows) try {
    const c = JSON.parse(row.data), pr = c.pr;
    if (!checkpointId.safeParse(c.id).success || c.id !== row.id || c.beforeSnapshotId !== saved.snapshotId || c.afterSnapshotId !== current.snapshotId || canonical(pr.baseRepository) !== saved.repositoryIdentity || canonical(pr.headRepository) !== saved.repositoryIdentity || pr.baseCommit !== saved.indexedCommit || pr.headCommit !== current.indexedCommit) continue;
    const url = new URL(pr.url);
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash || !/^\/[^/]+\/[^/]+\/pull\/[1-9]\d*$/.test(url.pathname) || canonical(`https://github.com${url.pathname.split('/').slice(0, 3).join('/')}`) !== saved.repositoryIdentity) continue;
    return { id: c.id, prUrl: pr.url, beforeSnapshotId: saved.snapshotId, afterSnapshotId: current.snapshotId };
  } catch { /* Invalid persisted comparison cannot authorize a Changes action. */ }
}
export function resumeCheckpoint(db, checkpointId, input, userId = null) {
  const p = resumeRequest.parse(input), { saved, current } = scoped(db, checkpointId, p.currentSnapshotId, userId), original = detail(db, saved);
  const byId = new Map(original.references.map(r => [r.id, r]));
  const items = saved.sourceReferenceIds.map(refId => {
    const old = byId.get(refId), item = { referenceId: refId, file: old?.file || '(unavailable)', status: 'unknown', scope: 'file', notice: 'Stored file evidence is unavailable or unmapped.' };
    if (!old) return item;
    const rows = db.prepare("SELECT id FROM source_references WHERE snapshot_id=? AND json_extract(data,'$.file')=? ORDER BY id LIMIT 25").all(current.snapshotId, old.file);
    const currentReference = rows.map(r => reference(db, current, r.id)).find(Boolean);
    if (!currentReference) return item;
    const source = db.prepare('SELECT content FROM source_files WHERE snapshot_id=? AND path=? AND length(content)<=300000');
    const a = source.get(saved.snapshotId, old.file), b = source.get(current.snapshotId, old.file);
    if (!a || !b || Buffer.byteLength(a.content) > 300000 || Buffer.byteLength(b.content) > 300000) return item;
    return { ...item, status: a.content === b.content ? 'unchanged' : 'changed', currentReference, notice: 'Compared complete stored file content in the saved and current connected snapshots; this does not establish a behavior change or analyze the local checkout.' };
  });
  const verified = items.length > 0 && items.every(i => i.status !== 'unknown');
  const comparison = original.snapshotAvailable ? existingComparison(db, saved, current) : undefined;
  return { detail: original, currentSnapshot: current, currentLocalContext: p.localContext, versions: { indexed: saved.indexedCommit.toLowerCase() === current.indexedCommit.toLowerCase() ? 'same' : 'different', localHead: saved.localContext.headCommit && p.localContext.headCommit ? (saved.localContext.headCommit.toLowerCase() === p.localContext.headCommit.toLowerCase() ? 'same' : 'different') : 'unknown' }, changes: { status: verified ? 'verified' : 'unavailable', notice: verified ? 'File content comparison uses connected analyzed snapshots only; local checkout changes and semantic behavior are not verified.' : 'Detailed source changes are unavailable or partly unverified against the connected analyzed snapshot. Local checkout changes are not analyzed.', items }, ...(comparison ? { comparison } : {}) };
}
