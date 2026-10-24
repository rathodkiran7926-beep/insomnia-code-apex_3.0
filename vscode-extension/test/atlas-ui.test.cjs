const test = require('node:test'); const assert = require('node:assert/strict');
const { AtlasTree, fullAtlasUrl } = require('../.test-output/activation.cjs');
const sha = 'a'.repeat(40); const ref = id => ({ id, file: 'a.ts', startLine: 1, endLine: 3 });
const c = id => ({ id, name: id, role: 'function', referenceId: `r${id}` });
const n = { repositoryIdentity: 'https://github.com/a/b', indexedCommit: sha, component: c('first'), components: [c('first'), c('other')], incoming: [], outgoing: [{ id: 'edge', source: 'first', target: 'other', type: 'imports', certainty: 'possible', referenceId: 'edge-ref' }], references: [ref('rfirst'), ref('rother'), ref('edge-ref')], documentation: [], limitations: ['Static source, not execution'], truncated: true, limit: 25 };
test('native Atlas exposes original semantics, separate evidence, compact groups and version-bound action tokens', () => {
  const tree = new AtlasTree({ state: { status: 'ready', message: 'Indexed static relationships', result: { id: 'view-1', neighborhood: n }, canBack: true } }, () => true);
  const rows = tree.getChildren(); const outgoing = rows.find(r => r.label.startsWith('Outgoing Relationships'));
  const edge = tree.getChildren(outgoing)[0]; assert.match(edge.description, /imports.*possible/); assert.doesNotMatch(edge.description, /calls|dependency/);
  assert.equal(edge.command.command, 'codebaseMentor.exploreComponent'); assert.equal(edge.action.componentId, 'other');
  const children = tree.getChildren(edge); assert.equal(children[0].action.referenceId, 'edge-ref'); assert.equal(children[1].action.referenceId, 'rother');
  assert(children.every(r => r.action.viewId === 'view-1')); assert(rows.some(r => /at most 25/.test(r.label)));
  assert(tree.getChildren(rows.find(r => r.label === 'Documentation')).some(r => /No component-specific/.test(r.label))); tree.dispose();
});
test('Map empty/error states offer real connection, selection and retry actions', () => {
  const atlas = { state: { status: 'idle', message: 'Select code', canBack: false } }; const tree = new AtlasTree(atlas, () => false);
  assert(tree.getChildren().some(r => r.command?.command === 'codebaseMentor.connectRepository'));
  atlas.state = { status: 'error', message: 'Backend unavailable', canBack: false }; assert(tree.getChildren().some(r => r.command?.command === 'codebaseMentor.refreshMap')); tree.dispose();
});
test('Map displays module fallback scope and current checkout warnings without reinterpreting evidence', () => {
  const tree = new AtlasTree({ state: { status: 'ready', message: 'Indexed', result: { id: 'v1', target: { scopeNotice: 'Selection spans declarations; enclosing module only.' }, neighborhood: n } } }, () => true, () => 'Local revision differs from indexed source.');
  const labels = tree.getChildren().map(r => r.label);
  assert(labels.includes('Selection spans declarations; enclosing module only.'));
  assert(labels.includes('Local revision differs from indexed source.')); tree.dispose();
});
test('web handoff uses only the real workspace route and rejects credentials, dangerous schemes and fake deep links', () => {
  assert.equal(fullAtlasUrl('http://127.0.0.1:5173'), 'http://127.0.0.1:5173/#/workspace');
  assert.equal(fullAtlasUrl('https://mentor.example/app'), 'https://mentor.example/app/#/workspace');
  for (const value of ['javascript:alert(1)', 'file:///secret', 'http://external.example', 'https://u:p@example.com', 'https://example.com/?snapshot=foo', 'https://example.com/#/component']) assert.throws(() => fullAtlasUrl(value));
});
