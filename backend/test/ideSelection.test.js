import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH = ':memory:';
const { analyze } = await import('../src/analyzer.js');
const { resolveSelection, selectionRequest } = await import('../src/ideSelection.js');
const files = { 'src/service.ts': 'export function first(id: string) {\n  if (!id) throw new Error("Missing id");\n  return id;\n}\n\nexport function second() {\n  return first("next");\n}\n' };
const graph = analyze({ repository: 'https://github.com/example/project', commit: 'a'.repeat(40), files });
const input = { snapshotId: graph.snapshotId, file: 'src/service.ts', startLine: 1, endLine: 4 };
const first = graph.components.find(c => c.name === 'first' && c.role !== 'module');

test('exact, partial and cursor selections resolve real containing declarations above modules', () => {
  for (const [startLine, endLine] of [[1, 4], [2, 2], [2, 3]]) {
    const result = resolveSelection(graph, { ...input, startLine, endLine });
    assert.equal(result.snapshotId, graph.snapshotId);
    assert.equal(result.candidates[0].componentId, first.id);
    assert.equal(result.candidates[0].referenceId, first.referenceId);
    assert.equal(result.scope, 'declaration');
  }
});
test('cross-function selections never fabricate a single enclosing function', () => {
  const result = resolveSelection(graph, { ...input, startLine: 2, endLine: 7 });
  assert(result.candidates.every(candidate => candidate.role === 'module'));
  assert.equal(result.scope, 'module'); assert.match(result.notice, /module/i);
});
test('nested declarations are ranked deterministically and results are bounded', () => {
  const original = graph.references.find(reference => reference.id === first.referenceId);
  const many = { ...graph, components: Array.from({ length: 40 }, (_, index) => ({ id: `real-${String(index).padStart(2, '0')}`, name: 'decl', role: 'function', referenceId: original.id })), references: [original] };
  const result = resolveSelection(many, input);
  assert.equal(result.candidates.length, 20); assert.equal(result.candidates[0].componentId, 'real-00');
  assert.deepEqual(result, resolveSelection(many, input));
});
test('unknown files, out-of-range selections and wrong-snapshot references never force a match', () => {
  assert.deepEqual(resolveSelection(graph, { ...input, file: 'missing.ts' }).candidates, []);
  assert.deepEqual(resolveSelection(graph, { ...input, startLine: 99, endLine: 99 }).candidates, []);
  assert.deepEqual(resolveSelection({ ...graph, references: graph.references.map(reference => ({ ...reference, snapshotId: 'other' })) }, input).candidates, []);
  assert.throws(() => resolveSelection({ ...graph, snapshotId: 'other' }, input));
});
test('selection input rejects traversal, absolute paths, malformed separators, IDs and bounds', () => {
  for (const file of ['/absolute.ts', 'C:/file.ts', '../secret', 'a/../b', 'a\\b', 'a//b', 'a/./b', 'a/%2e%2e/b', 'file:///a', 'a\0.ts']) assert.throws(() => selectionRequest.parse({ ...input, file }));
  for (const body of [{ ...input, startLine: 0 }, { ...input, endLine: 0 }, { ...input, startLine: 4, endLine: 2 }, { ...input, endLine: 1000001 }, { ...input, snapshotId: '../x' }, { ...input, snapshotId: '' }, { ...input, file: 'x'.repeat(1001) }, { ...input, contents: 'not accepted' }]) assert.throws(() => selectionRequest.parse(body));
});
test('nested containing declarations rank the more specific source range first', () => {
  const nested = analyze({ repository: graph.repository, commit: 'b'.repeat(40), files: { 'nested.ts': 'export function outer() {\n function inner() {\n  return 1;\n }\n return inner();\n}\n' } });
  const result = resolveSelection(nested, { snapshotId: nested.snapshotId, file: 'nested.ts', startLine: 3, endLine: 3 });
  assert.deepEqual(result.candidates.map(item => item.name), ['inner', 'outer']);
});
test('real router uses stored snapshots and returns bounded JSON errors for bad HTTP requests', async t => {
  const { default: express } = await import('express');
  const { z } = await import('zod');
  const { db, saveSnapshot } = await import('../src/storage.js');
  const { ideRoutes } = await import('../src/ideRoutes.js');
  saveSnapshot(graph, { snapshotId: graph.snapshotId }, '', files);
  const app = express(); app.use(express.json({ limit: '24kb' })); app.use('/api/ide', ideRoutes);
  app.use((error, _req, res, _next) => res.status(error instanceof z.ZodError ? 400 : error.status || 500).json({ error: 'Invalid request' }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); db.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/ide/resolve-selection`;
  const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const valid = await post(input); assert.equal(valid.status, 200); assert.equal((await valid.json()).candidates[0].componentId, first.id);
  assert.equal((await post({ ...input, snapshotId: 'missing' })).status, 404);
  for (const invalid of [{}, null, { ...input, file: '../secret' }, { ...input, startLine: -1 }, { ...input, source: 'forbidden' }]) assert.equal((await post(invalid)).status, 400);
  assert.equal((await post({ ...input, file: 'x'.repeat(30000) })).status, 413);
});
