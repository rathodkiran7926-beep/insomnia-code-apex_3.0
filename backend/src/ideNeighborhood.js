import { z } from 'zod';

export const neighborhoodId = z.string().min(1).max(200).regex(/^[\w-]+$/);
export const neighborhoodQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  direction: z.enum(['both', 'incoming', 'outgoing']).default('both'),
  relationshipType: z.string().min(1).max(80).regex(/^[\w-]+$/).optional(),
}).strict();
const missing = message => Object.assign(new Error(message), { status: 404 });
const boundedText = (v, n) => typeof v === 'string' && v.length > 0 && v.length <= n;
function component(row) {
  if (!row) return;
  const c = JSON.parse(row.data);
  if (![c.id, c.referenceId].every(v => boundedText(v, 200)) || !boundedText(c.name, 300) || !boundedText(c.role, 80)) return;
  return { id: c.id, name: c.name, role: c.role, referenceId: c.referenceId,
    ...(typeof c.inferred === 'boolean' ? { inferred: c.inferred } : {}) };
}
function reference(row, snapshotId) {
  if (!row) return;
  const r = JSON.parse(row.data);
  if (r.snapshotId !== snapshotId || !boundedText(r.id, 200) || !boundedText(r.file, 1000) || !boundedText(r.url, 3000) || !Number.isSafeInteger(r.startLine) || !Number.isSafeInteger(r.endLine) || r.startLine < 1 || r.endLine < r.startLine || r.endLine > 1000000) return;
  return { id: r.id, snapshotId, file: r.file, startLine: r.startLine, endLine: r.endLine, url: r.url };
}

/** Projection of already persisted evidence; no analysis, AI, source reads or graph traversal. */
export function readNeighborhood(db, snapshotId, componentId, query) {
  const snapshot = db.prepare("SELECT repository_id, commit_sha, json_extract(graph_json,'$.report.limitations') AS limitations FROM snapshots WHERE id=?").get(snapshotId);
  if (!snapshot) throw missing('Snapshot not found');
  const readComponent = db.prepare('SELECT data FROM components WHERE snapshot_id=? AND id=?');
  const readReference = db.prepare('SELECT data FROM source_references WHERE snapshot_id=? AND id=?');
  const selected = component(readComponent.get(snapshotId, componentId));
  if (!selected || selected.id !== componentId) throw missing('Component not found in this snapshot');
  const refs = new Map(); const nodes = new Map([[selected.id, selected]]);
  const addReference = id => {
    if (refs.has(id)) return true;
    const ref = reference(readReference.get(snapshotId, id), snapshotId);
    if (!ref || ref.id !== id) return false;
    refs.set(id, ref); return true;
  };
  if (!addReference(selected.referenceId)) throw missing('Component source evidence unavailable');
  const { limit, direction, relationshipType } = query;
  // Snapshot-scoped joins exclude dangling nodes and evidence before applying LIMIT.
  const rows = db.prepare(`SELECT e.data FROM relationships e
    JOIN components s ON s.snapshot_id=e.snapshot_id AND s.id=json_extract(e.data,'$.source')
    JOIN components t ON t.snapshot_id=e.snapshot_id AND t.id=json_extract(e.data,'$.target')
    JOIN source_references r ON r.snapshot_id=e.snapshot_id AND r.id=json_extract(e.data,'$.referenceId')
    WHERE e.snapshot_id=? AND json_extract(r.data,'$.snapshotId')=e.snapshot_id
    AND ((?!='outgoing' AND json_extract(e.data,'$.target')=?) OR (?!='incoming' AND json_extract(e.data,'$.source')=?))
    AND (? IS NULL OR json_extract(e.data,'$.type')=?) ORDER BY e.id LIMIT ?`)
    .all(snapshotId, direction, componentId, direction, componentId, relationshipType ?? null, relationshipType ?? null, limit + 1);
  const incoming = [], outgoing = [];
  let omitted = false;
  for (const row of rows.slice(0, limit)) {
    const edge = JSON.parse(row.data);
    if (![edge.id, edge.source, edge.target, edge.referenceId].every(v => boundedText(v, 200)) || !boundedText(edge.type, 80)) { omitted = true; continue; }
    const source = nodes.get(edge.source) ?? component(readComponent.get(snapshotId, edge.source));
    const target = nodes.get(edge.target) ?? component(readComponent.get(snapshotId, edge.target));
    if (!source || !target || !addReference(source.referenceId) || !addReference(target.referenceId) || !addReference(edge.referenceId)) { omitted = true; continue; }
    const item = { id: edge.id, source: edge.source, target: edge.target, type: edge.type, referenceId: edge.referenceId };
    if (boundedText(edge.certainty, 80)) item.certainty = edge.certainty;
    if (typeof edge.inferred === 'boolean') item.inferred = edge.inferred;
    if (boundedText(edge.mountPath, 1000)) item.mountPath = edge.mountPath;
    if (Array.isArray(edge.evidence)) item.evidence = edge.evidence.filter(v => boundedText(v, 1000)).slice(0, 8);
    nodes.set(source.id, source); nodes.set(target.id, target);
    if (edge.target === componentId && direction !== 'outgoing') incoming.push(item);
    if (edge.source === componentId && direction !== 'incoming') outgoing.push(item);
  }
  const storedDocs = db.prepare('SELECT data FROM documentation WHERE snapshot_id=?').get(snapshotId);
  const docs = storedDocs && JSON.parse(storedDocs.data);
  const documentation = [];
  if (docs?.snapshotId === snapshotId) for (const item of (docs.ai?.explanations ?? []).slice(0, 20)) {
    if (item.componentId !== componentId || item.inferred !== true || !boundedText(item.explanation, 1200) || !Array.isArray(item.referenceIds) || !item.referenceIds.length || item.referenceIds.length > 8 || !item.referenceIds.every(id => boundedText(id, 200) && addReference(id))) continue;
    documentation.push({ componentId, explanation: item.explanation, inferred: true, referenceIds: item.referenceIds });
    break;
  }
  const limitations = JSON.parse(snapshot.limitations || '[]').filter(v => boundedText(v, 1000)).slice(0, 30);
  if (omitted) limitations.push('Some stored relationships have unavailable evidence and were omitted.');
  return { snapshotId, repository: snapshot.repository_id, commit: snapshot.commit_sha,
    component: selected, components: [...nodes.values()], incoming, outgoing, references: [...refs.values()],
    documentation, limitations, truncated: rows.length > limit, limit };
}
