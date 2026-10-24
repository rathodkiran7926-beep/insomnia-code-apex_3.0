const test = require('node:test'); const assert = require('node:assert/strict');
const { CheckpointController, ApiError } = require('../.test-output/library.cjs');
const binding = { version: 1, workspaceUri: 'file:///repo', backendUrl: 'http://127.0.0.1:3001/', snapshotId: 'snap', repositoryIdentity: 'https://github.com/a/b', indexedCommit: 'a'.repeat(40), connectedAt: 'saved' };
const input = { requestId: '11111111-1111-4111-8111-111111111111', snapshotId: 'snap', taskTitle: 'Investigate component behavior', notes: { discovery: 'Exact user note\n', unresolved: 'User question?', nextStep: '' }, localContext: { branch: 'feature', headCommit: binding.indexedCommit, gitStatus: 'clean' }, sourceReferenceIds: [] };
const detail = { checkpoint: { ...binding, id: 'checkpoint', schemaVersion: 1, taskTitle: input.taskTitle, notes: input.notes, localContext: input.localContext, sourceReferenceIds: [], createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z' }, snapshotAvailable: true, references: [], components: [], warnings: [] };
function setup() {
  let current = binding, enabled = true, trusted = true, failure; const calls = [];
  const api = { backendIdentity: binding.backendUrl,
    checkpointCapability: async () => { calls.push('capability'); return { enabled, mode: 'local-single-user', schemaVersion: 1, notice: 'Local only' }; },
    listCheckpoints: async (_binding, limit, offset) => { calls.push('list'); if (failure) throw failure; return { repositoryIdentity: binding.repositoryIdentity, items: [], limit, offset, hasMore: false }; },
    createCheckpoint: async (_binding, body) => { calls.push(['create', body]); if (failure) throw failure; return detail; },
    checkpoint: async () => { calls.push('detail'); if (failure) throw failure; return detail; },
    resumeCheckpoint: async () => { calls.push('resume'); if (failure) throw failure; return { detail, versions: { indexed: 'same', localHead: 'same' } }; },
    deleteCheckpoint: async () => { calls.push('delete'); if (failure) throw failure; return { id: 'checkpoint', deleted: true }; },
  };
  const env = { binding: () => current, trusted: () => trusted, local: () => input.localContext };
  const controller = new CheckpointController(api, env);
  return { controller, api, env, calls, setBinding: b => current = b, setEnabled: b => enabled = b, setTrusted: b => trusted = b, setFailure: e => failure = e };
}
test('disabled, untrusted and missing binding never load/save notes', async () => {
  const s = setup(); s.setEnabled(false); await s.controller.refresh(); assert.equal(s.controller.state.status, 'disabled'); assert(!s.calls.includes('list'));
  s.setTrusted(false); await s.controller.save(binding, input); assert.equal(s.calls.filter(c => Array.isArray(c)).length, 0);
});
test('approved save is deduplicated, preserves notes and serializes an immediate Refresh', async () => {
  const s = setup(); let finish; s.api.createCheckpoint = async (_b, body) => { s.calls.push(['create', body]); return new Promise(r => finish = r); };
  const first = s.controller.save(binding, input); await new Promise(r => setImmediate(r)); const second = s.controller.save(binding, input); const refresh = s.controller.refresh();
  assert.equal(s.calls.filter(c => Array.isArray(c) && c[0] === 'create').length, 1); finish(detail);
  await Promise.all([first, second, refresh]); assert.equal(s.controller.state.detail.checkpoint.notes.discovery, input.notes.discovery); assert.equal(s.controller.state.status, 'ready');
});
test('workspace/backend changes during Save never publish the old checkpoint into the new context', async () => {
  const s = setup(); let finish; s.api.createCheckpoint = () => new Promise(r => finish = r);
  const save = s.controller.save(binding, input); await new Promise(r => setImmediate(r)); s.setBinding({ ...binding, snapshotId: 'other' }); s.controller.contextChanged(); finish(detail); await save;
  assert.equal(s.controller.state.detail, undefined); assert.equal(s.controller.state.page, undefined);
});
test('delete cancels a pending Resume and late context cannot resurrect the removed checkpoint', async () => {
  const s = setup(); await s.controller.view('checkpoint'); let finish; s.api.resumeCheckpoint = () => new Promise(r => finish = r);
  const resume = s.controller.resume('checkpoint'); await new Promise(r => setImmediate(r)); const deletion = s.controller.delete('checkpoint', s.controller.state.viewId); await deletion;
  finish({ detail }); await resume; assert.equal(s.controller.state.detail, undefined); assert.equal(s.controller.state.resume, undefined); assert(s.calls.includes('delete'));
});
test('save errors are uncertain, never automatically retried and never echo note-bearing server errors', async () => {
  const s = setup(); s.setFailure(new ApiError('network', input.notes.discovery)); await s.controller.save(binding, input);
  assert.equal(s.controller.state.status, 'error'); assert(!s.controller.state.message.includes(input.notes.discovery)); assert.match(s.controller.state.message, /may have|uncertain|Refresh/);
  assert.equal(s.calls.filter(c => Array.isArray(c) && c[0] === 'create').length, 1);
});
test('saved context survives controller recreation through backend retrieval and stale tokens reject navigation', async () => {
  const s = setup(); await s.controller.view('checkpoint'); const token = s.controller.state.viewId; s.controller.dispose();
  const next = setup(); await next.controller.resume('checkpoint'); assert.equal(next.controller.state.detail.checkpoint.notes.unresolved, input.notes.unresolved);
  assert.throws(() => next.controller.current(token + '-old'));
});

test('refreshing the same checkpoint retains its immutable navigation context while awaiting the backend', async () => {
  const s = setup(); await s.controller.view('checkpoint'); let finish;
  s.api.resumeCheckpoint = () => new Promise(resolve => finish = resolve);
  const resuming = s.controller.resume('checkpoint'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.controller.state.detail?.checkpoint.id, 'checkpoint');
  finish({ detail }); await resuming;
  s.controller.dispose();
});

test('temporary binding revalidation retains private checkpoint state but blocks writes until ready', async () => {
  const s = setup(); s.env.recoverableBinding = () => binding;
  await s.controller.view('checkpoint'); const token = s.controller.state.viewId;
  s.setBinding(undefined); s.controller.contextChanged();
  assert.equal(s.controller.state.binding, binding);
  assert.equal(s.controller.state.detail.checkpoint.notes.discovery, input.notes.discovery);
  assert.equal(s.controller.state.status, 'error');
  assert.throws(() => s.controller.current(token));
  await s.controller.save(binding, input);
  assert.equal(s.calls.filter(c => Array.isArray(c) && c[0] === 'create').length, 0);
  s.setBinding(binding); s.controller.contextChanged();
  assert.equal(s.controller.state.status, 'ready');
  assert.equal(s.controller.current(token).detail.checkpoint.id, 'checkpoint');
  s.setBinding(undefined); s.env.recoverableBinding = () => ({ ...binding, snapshotId: 'different' }); s.controller.contextChanged();
  assert.equal(s.controller.state.binding, undefined); assert.equal(s.controller.state.detail, undefined);
  s.controller.dispose();
});

test('invalid backend configuration clears checkpoint context without a lifecycle exception', async () => {
  const s = setup(); await s.controller.view('checkpoint');
  Object.defineProperty(s.api, 'backendIdentity', { get() { throw new Error('Invalid backend URL'); } });
  assert.doesNotThrow(() => s.controller.contextChanged());
  assert.equal(s.controller.state.binding, undefined); assert.equal(s.controller.state.detail, undefined);
  s.controller.dispose();
});
