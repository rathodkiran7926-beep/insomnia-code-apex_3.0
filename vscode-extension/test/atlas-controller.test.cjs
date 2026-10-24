const test = require('node:test'); const assert = require('node:assert/strict');
const { AtlasController, ApiError } = require('../.test-output/library.cjs');
const binding = { workspaceUri: 'file:///repo', backendUrl: 'http://127.0.0.1:3001/', snapshotId: 'snap', repositoryIdentity: 'https://github.com/a/b', indexedCommit: 'a'.repeat(40) };
const c = id => ({ id, name: id, role: 'function', referenceId: `r-${id}` });
const context = { workspaceUri: binding.workspaceUri, repositoryRootUri: binding.workspaceUri, file: 'a.ts', binding, selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
const target = id => ({ binding, snapshot: { ...binding, limitations: [] }, component: c(id), sourceContext: context, scopeNotice: 'Indexed component' });
function setup() {
  let current = binding, workspace = binding.workspaceUri, failure, resolved = target('c0'); const calls = [];
  const api = { backendIdentity: binding.backendUrl, neighborhood: async (snap, id, limit, signal) => {
    calls.push([snap, id, limit, signal]); if (failure) throw failure;
    return { ...target(id).snapshot, component: c(id), components: [c(id), c('c1')], incoming: [], outgoing: [{ id: 'e', source: id, target: 'c1', type: 'calls', referenceId: 'edge-ref' }], references: [], documentation: [], truncated: false, limit };
  } };
  const env = { trusted: () => true, binding: () => current, workspace: () => workspace, editor: () => context, resolve: async () => resolved };
  const atlas = new AtlasController(api, env);
  return { atlas, api, env, calls, setBinding: b => current = b, setWorkspace: w => workspace = w, setFailure: e => failure = e, setResolved: r => resolved = r };
}
test('Map uses shared resolution, explores supported IDs, back and editor target without graph history', async () => {
  assert.equal(typeof AtlasController, 'function'); const s = setup();
  await s.atlas.showRelated(); assert.equal(s.atlas.state.result.target.component.id, 'c0');
  await s.atlas.explore('c1', s.atlas.state.result.id); assert.equal(s.atlas.state.result.target.component.id, 'c1');
  assert.equal(s.atlas.state.canBack, true); await s.atlas.back(); assert.equal(s.atlas.state.result.target.component.id, 'c0');
  await s.atlas.explore('c1', s.atlas.state.result.id); await s.atlas.backToEditor(); assert.equal(s.atlas.state.result.target.component.id, 'c0');
  assert(s.calls.every(call => call[0] === 'snap')); s.atlas.dispose();
});
test('Map never explores unknown or stale view tokens', async () => {
  const s = setup(); await s.atlas.showRelated(); const id = s.atlas.state.result.id; const count = s.calls.length;
  await assert.rejects(() => s.atlas.explore('unknown', id)); assert.equal(s.calls.length, count);
  await s.atlas.refresh(); await assert.rejects(() => s.atlas.explore('c1', id)); assert.equal(s.calls.length, count + 1);
});
test('binding/backend/workspace changes clear actionable graph and cancel obsolete requests', async () => {
  for (const change of [s => s.setBinding(undefined), s => s.setBinding({ ...binding, snapshotId: 'other' }), s => s.setWorkspace('file:///different'), s => s.api.backendIdentity = 'https://other.example/']) {
    const s = setup(); await s.atlas.showRelated(); change(s); s.atlas.contextChanged(); assert.equal(s.atlas.state.result, undefined);
  }
});
test('superseded and disposed requests cannot publish; repeated same target is deduplicated', async () => {
  const s = setup(); const finishes = [];
  s.api.neighborhood = async (_snap, id, limit, signal) => new Promise(resolve => finishes.push({ id, limit, signal, resolve }));
  const first = s.atlas.open(target('c0')); const duplicate = s.atlas.open(target('c0')); assert.equal(finishes.length, 1);
  const second = s.atlas.open(target('c1')); assert.equal(finishes[0].signal.aborted, true);
  const result = f => ({ ...target(f.id).snapshot, component: c(f.id), components: [c(f.id)], incoming: [], outgoing: [], references: [], documentation: [], truncated: false, limit: f.limit });
  finishes[1].resolve(result(finishes[1])); await second; finishes[0].resolve(result(finishes[0])); await first; await duplicate;
  assert.equal(s.atlas.state.result.target.component.id, 'c1'); s.atlas.dispose();
});
test('no binding and unsupported selection remain honest; rate limit retains prior graph and Retry recovers', async () => {
  const s = setup(); s.setResolved(undefined); await s.atlas.showRelated(); assert.equal(s.atlas.state.status, 'empty');
  s.setResolved(target('c0')); await s.atlas.showRelated(); s.setFailure(new ApiError('http', 'busy', 429)); await s.atlas.refresh();
  assert.equal(s.atlas.state.status, 'error'); assert.match(s.atlas.state.message, /429/); assert.equal(s.atlas.state.result.target.component.id, 'c0');
  s.setFailure(undefined); await s.atlas.refresh(); assert.equal(s.atlas.state.status, 'ready');
});
