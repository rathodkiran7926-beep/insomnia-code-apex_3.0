const test = require('node:test');
const assert = require('node:assert/strict');
const { validateNeighborhood } = require('../.test-output/library.cjs');
const sha = 'a'.repeat(40);
const ref = (id, line) => ({ id, snapshotId: 'snap', file: 'a.ts', startLine: line, endLine: line, url: `https://github.com/a/b/blob/${sha}/a.ts#L${line}-L${line}` });
const component = { id: 'c0', name: 'first', role: 'function', referenceId: 'r0' };
const related = { id: 'c1', name: 'next', role: 'function', referenceId: 'r1', inferred: true };
const edge = { id: 'e0', source: 'c0', target: 'c1', type: 'imports', certainty: 'possible', inferred: true, referenceId: 'r2' };
const body = () => ({ snapshotId: 'snap', repository: 'https://github.com/a/b', commit: sha, component, components: [component, related], incoming: [], outgoing: [edge], references: [ref('r0', 1), ref('r1', 2), ref('r2', 3)], documentation: [], limitations: ['Static source, not execution'], truncated: false, limit: 25 });
test('Atlas preserves original edge semantics and distinct evidence with bounded identity validation', () => {
  assert.equal(typeof validateNeighborhood, 'function');
  const result = validateNeighborhood(body(), 'snap', 'c0', 25);
  assert.equal(result.outgoing[0].type, 'imports'); assert.equal(result.outgoing[0].certainty, 'possible');
  assert.equal(result.outgoing[0].referenceId, 'r2'); assert.equal(result.components[1].inferred, true);
  assert.equal(result.indexedCommit, sha); assert.equal(result.repositoryIdentity, body().repository);
});
test('Atlas rejects cross-snapshot, reversed direction, dangling or malicious references and oversized lists', () => {
  for (const mutate of [b => b.snapshotId = 'other', b => b.component = related, b => b.incoming = [edge], b => b.outgoing[0] = { ...edge, target: 'missing' }, b => b.references[0] = { ...ref('r0', 1), snapshotId: 'other' }, b => b.references[2] = { ...ref('r2', 3), file: '../secret' }, b => b.outgoing = Array(26).fill(edge), b => b.truncated = 'false', b => b.documentation = [{ componentId: 'c1', explanation: 'bad', inferred: true, referenceIds: ['r0'] }]]) {
    const b = structuredClone(body()); mutate(b); assert.throws(() => validateNeighborhood(b, 'snap', 'c0', 25));
  }
});
module.exports = { body, component, related, edge };
