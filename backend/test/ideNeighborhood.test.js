import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH = ':memory:';
const { analyze } = await import('../src/analyzer.js');
const { db, saveSnapshot } = await import('../src/storage.js');
const files = { 'a.ts': 'export function leaf() { return 1; }\nexport function caller() { return leaf(); }\nexport function alone() { return 2; }\n' };
const graph = analyze({ repository: 'https://github.com/a/b', commit: 'a'.repeat(40), files });
saveSnapshot(graph, { snapshotId: graph.snapshotId, ai: { explanations: [] } }, '', files);
const leaf = graph.components.find(c => c.name === 'leaf');
const caller = graph.components.find(c => c.name === 'caller');
const alone = graph.components.find(c => c.name === 'alone');
let base, server;
test.before(async () => {
  const { default: express } = await import('express'); const { z } = await import('zod');
  const { ideRoutes } = await import('../src/ideRoutes.js');
  const app = express(); app.use(express.json()); app.use('/api/ide', ideRoutes);
  app.use((e, _q, r, _n) => r.status(e instanceof z.ZodError ? 400 : e.status || 500).json({ error: e.message }));
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/ide/snapshots`;
});
test.after(() => { server.closeAllConnections(); server.close(); db.close(); });
const get = (id = leaf.id, query = '', snapshot = graph.snapshotId) => fetch(`${base}/${snapshot}/components/${encodeURIComponent(id)}/neighborhood${query}`);
test('persisted analyzer edge direction, original type, certainty and distinct call-site evidence survive', async () => {
  const response = await get(); assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.component.id, leaf.id); assert.equal(body.commit, graph.commit); assert.equal(body.repository, graph.repository);
  const stored = graph.relationships.find(e => e.source === caller.id && e.target === leaf.id);
  assert.deepEqual(body.incoming.find(e => e.id === stored.id), stored); assert.equal(body.outgoing.length, 0);
  assert(body.components.some(c => c.id === caller.id)); assert(body.references.some(r => r.id === stored.referenceId));
  assert(body.references.every(r => r.snapshotId === graph.snapshotId && !('excerpt' in r)));
  const outgoing = await (await get(caller.id)).json(); assert.equal(outgoing.outgoing[0].target, leaf.id);
});
test('empty is valid; snapshot-scoped missing and malformed components/query fail explicitly', async () => {
  assert.deepEqual((await (await get(alone.id)).json()).incoming, []);
  for (const [id, query, snapshot, status] of [['missing', '', graph.snapshotId, 404], [leaf.id, '', 'missing', 404], ['..bad', '', graph.snapshotId, 400], [leaf.id, '?limit=0', graph.snapshotId, 400], [leaf.id, '?limit=101', graph.snapshotId, 400], [leaf.id, '?direction=sideways', graph.snapshotId, 400], [leaf.id, '?extra=1', graph.snapshotId, 400]]) assert.equal((await get(id, query, snapshot)).status, status);
  const other = analyze({ repository: graph.repository, commit: 'b'.repeat(40), files: { 'z.ts': 'export const z = 1;' } });
  saveSnapshot(other, { snapshotId: other.snapshotId }, ''); assert.equal((await get(caller.id, '', other.snapshotId)).status, 404);
});
test('bounded edges retain unknown types and possible certainty; missing nodes/references are omitted', async () => {
  const insert = db.prepare('INSERT INTO relationships VALUES (?,?,?)');
  for (let i = 0; i < 30; i++) insert.run(`extra-${i}`, graph.snapshotId, JSON.stringify({ id: `extra-${i}`, source: caller.id, target: leaf.id, type: 'future_type', certainty: 'possible', inferred: true, referenceId: caller.referenceId }));
  for (const [id, target, referenceId] of [['bad-node', 'unknown', caller.referenceId], ['bad-ref', leaf.id, 'missing-ref']]) insert.run(id, graph.snapshotId, JSON.stringify({ id, source: caller.id, target, type: 'calls', referenceId }));
  const body = await (await get(leaf.id, '?limit=5&direction=incoming&relationshipType=future_type')).json();
  assert.equal(body.incoming.length, 5); assert.equal(body.outgoing.length, 0); assert.equal(body.truncated, true);
  assert(body.incoming.every(e => e.type === 'future_type' && e.certainty === 'possible' && e.inferred === true));
  const all = await (await get()).json(); assert(!all.incoming.some(e => e.id.startsWith('bad-')));
  assert(all.limitations.some(s => /static/i.test(s)));
});
test('stored inferred documentation remains labelled, snapshot-bound and source-backed without generation', async () => {
  const put = docs => db.prepare('UPDATE documentation SET data=? WHERE snapshot_id=?').run(JSON.stringify(docs), graph.snapshotId);
  put({ snapshotId: graph.snapshotId, ai: { explanations: [{ componentId: leaf.id, explanation: 'Stored inferred description.', inferred: true, referenceIds: [leaf.referenceId] }] } });
  const body = await (await get()).json(); assert.equal(body.documentation.length, 1); assert.equal(body.documentation[0].inferred, true);
  assert(body.references.some(r => r.id === body.documentation[0].referenceIds[0]));
  for (const doc of [{ componentId: 'other', explanation: 'Wrong scope', inferred: true, referenceIds: [leaf.referenceId] }, { componentId: leaf.id, explanation: 'Bad ref', inferred: true, referenceIds: ['missing'] }]) {
    put({ snapshotId: graph.snapshotId, ai: { explanations: [doc] } }); assert.deepEqual((await (await get()).json()).documentation, []);
  }
  put({ snapshotId: 'other', ai: { explanations: [{ componentId: leaf.id, explanation: 'Wrong snapshot', inferred: true, referenceIds: [leaf.referenceId] }] } });
  assert.deepEqual((await (await get()).json()).documentation, []);
});
test('cross-snapshot source evidence is never returned, and selected missing evidence fails explicitly', async () => {
  const original = graph.references.find(r => r.id === leaf.referenceId);
  db.prepare('UPDATE source_references SET data=? WHERE snapshot_id=? AND id=?').run(JSON.stringify({ ...original, snapshotId: 'other' }), graph.snapshotId, original.id);
  assert.equal((await get()).status, 404);
  const outgoing = await (await get(caller.id)).json(); assert(!outgoing.components.some(c => c.id === leaf.id));
  db.prepare('UPDATE source_references SET data=? WHERE snapshot_id=? AND id=?').run(JSON.stringify(original), graph.snapshotId, original.id);
});
