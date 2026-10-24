const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RepositoryController, BindingStore, ApiError } = require('../.test-output/library.cjs');
const sha = 'a'.repeat(40);
const snapshot = { snapshotId: 'snap-1', repositoryIdentity: 'https://github.com/a/b', indexedCommit: sha, limitations: [] };
function setup() {
  const values = new Map(); const storage = { get: key => values.get(key), update: async (key, value) => { if (value === undefined) values.delete(key); else values.set(key, value); } };
  const folders = [{ uri: 'file:///one', name: 'same' }, { uri: 'file:///two', name: 'same' }];
  let backend = 'http://127.0.0.1:3001/'; let error; let trusted = true;
  let local = { rootUri: 'file:///one', identity: 'https://github.com/a/b', head: sha, branch: 'main', dirty: false };
  const api = { get backendIdentity() { return backend; }, snapshot: async () => { if (error) throw error; return snapshot; } };
  const env = { folders: () => folders, trusted: () => trusted, git: () => local };
  const store = new BindingStore(storage);
  const controller = new RepositoryController(api, store, env);
  return { controller, store, env, api, folders, setLocal: value => { local = value; }, setBackend: value => { backend = value; }, setError: value => { error = value; }, setTrusted: value => { trusted = value; } };
}
test('connection requires confirmation, rejects identity mismatch, and allows acknowledged unknown or different revision', async () => {
  const s = setup();
  assert.equal(await s.controller.connect(s.folders[0], 'snap-1', async () => false), false);
  assert.equal(s.controller.context(s.folders[0]).binding, undefined);
  s.setLocal({ identity: 'https://github.com/other/repo', head: sha });
  await assert.rejects(s.controller.connect(s.folders[0], 'snap-1', async () => { throw new Error('Must not confirm mismatch'); }), /different repository/i);
  s.setLocal({});
  assert.equal(await s.controller.connect(s.folders[0], 'snap-1', async (_snapshot, _local, comparison) => comparison.identity === 'unverified'), true);
  assert.equal(s.controller.context(s.folders[0]).comparison.identity, 'unverified');
  s.setLocal({ identity: 'https://github.com/a/b', head: 'b'.repeat(40), dirty: true });
  assert.equal(s.controller.context(s.folders[0]).comparison.revision, 'different');
  assert.equal(s.controller.context(s.folders[0]).comparison.localChanges, true);
  s.controller.dispose();
});
test('two same-name folders persist independently and restore after restart; disconnect removes only one', async () => {
  const s = setup();
  await s.controller.connect(s.folders[0], 'snap-1', async () => true);
  await s.controller.connect(s.folders[1], 'snap-1', async () => true);
  s.controller.dispose();
  const restarted = new RepositoryController(s.api, s.store, s.env); await restarted.restore();
  assert.equal(restarted.context(s.folders[0]).status, 'ready'); assert.equal(restarted.context(s.folders[1]).status, 'ready');
  await restarted.disconnect(s.folders[0]);
  assert.equal(restarted.context(s.folders[0]).binding, undefined); assert.equal(restarted.context(s.folders[1]).binding.snapshotId, 'snap-1');
  restarted.dispose();
});
test('backend changes, missing snapshots, malformed responses and reconnection remain recoverable', async () => {
  const s = setup(); await s.controller.connect(s.folders[0], 'snap-1', async () => true);
  s.setBackend('http://127.0.0.1:3002/'); await s.controller.restore();
  assert.equal(s.controller.context(s.folders[0]).status, 'other-backend'); assert.equal(s.controller.context(s.folders[0]).binding, undefined);
  s.setBackend('http://127.0.0.1:3001/'); s.setError(new ApiError('http', 'Not found', 404)); await s.controller.restore();
  assert.equal(s.controller.context(s.folders[0]).status, 'missing');
  s.setError(new ApiError('response', 'Malformed')); await s.controller.refresh(s.folders[0]);
  assert.equal(s.controller.context(s.folders[0]).status, 'error');
  s.setError(new ApiError('network', 'Offline')); await s.controller.refresh(s.folders[0]);
  assert.equal(s.controller.context(s.folders[0]).status, 'unavailable'); assert.ok(s.controller.context(s.folders[0]).binding);
  s.setError(undefined); await s.controller.refresh(s.folders[0]); assert.equal(s.controller.context(s.folders[0]).status, 'ready');
  s.setTrusted(false); await s.controller.refresh(s.folders[0]); assert.equal(s.controller.context(s.folders[0]).status, 'untrusted');
  s.controller.dispose();
});
test('disconnect cancels in-flight refresh and late responses cannot restore its binding', async () => {
  const s = setup(); await s.controller.connect(s.folders[0], 'snap-1', async () => true);
  let finish; let signal;
  s.api.snapshot = (_id, value) => { signal = value; return new Promise(resolve => { finish = resolve; }); };
  const pending = s.controller.refresh(s.folders[0]);
  await new Promise(resolve => setImmediate(resolve));
  await s.controller.disconnect(s.folders[0]); assert.equal(signal.aborted, true);
  finish(snapshot); await pending;
  assert.equal(s.controller.context(s.folders[0]).binding, undefined); s.controller.dispose();
});
test('local Git changes or backend changes during confirmation invalidate the proposed binding', async () => {
  const s = setup();
  await assert.rejects(s.controller.connect(s.folders[0], 'snap-1', async () => { s.setLocal({ identity: 'https://github.com/other/repo' }); return true; }), /changed/i);
  assert.equal(s.controller.context(s.folders[0]).binding, undefined);
  s.setLocal({ identity: 'https://github.com/a/b', head: sha });
  await assert.rejects(s.controller.connect(s.folders[0], 'snap-1', async () => { s.setBackend('http://127.0.0.1:3002/'); return true; }), /changed/i);
  s.controller.dispose();
});

test('cancelled connect during asynchronous disconnect cannot resurrect the deleted binding', async () => {
  const s = setup(); await s.controller.connect(s.folders[0], 'snap-1', async () => true);
  const remove = s.store.remove.bind(s.store); let finishRemoval; let finishConfirmation;
  s.store.remove = async uri => { await new Promise(resolve => { finishRemoval = resolve; }); await remove(uri); };
  const disconnect = s.controller.disconnect(s.folders[0]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.controller.bindingFor(s.folders[0].uri), undefined);
  await s.controller.restore();
  assert.equal(s.controller.bindingFor(s.folders[0].uri), undefined, 'Restore must not reload a binding being removed');
  const connect = s.controller.connect(s.folders[0], 'snap-1', () => new Promise(resolve => { finishConfirmation = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  finishRemoval(); await disconnect; finishConfirmation(false); await connect;
  assert.equal(s.controller.bindingFor(s.folders[0].uri), undefined);
  assert.equal(s.store.read(s.folders[0].uri, s.api.backendIdentity).status, 'none'); s.controller.dispose();
});

for (const operation of ['refresh', 'restore']) test(`${operation} during snapshot persistence keeps active and saved bindings consistent`, async () => {
  const s = setup(); await s.controller.connect(s.folders[0], 'snap-1', async () => true);
  s.api.snapshot = async id => ({ ...snapshot, snapshotId: id });
  const save = s.store.save.bind(s.store); let finishSave;
  s.store.save = async binding => { await new Promise(resolve => { finishSave = resolve; }); await save(binding); };
  const connect = s.controller.connect(s.folders[0], 'snap-2', async () => true);
  await new Promise(resolve => setImmediate(resolve));
  const refresh = operation === 'restore' ? s.controller.restore() : s.controller.refresh(s.folders[0]);
  finishSave(); await Promise.all([connect, refresh]);
  assert.equal(s.controller.context(s.folders[0]).binding.snapshotId, 'snap-2');
  assert.equal(s.store.read(s.folders[0].uri, s.api.backendIdentity).binding.snapshotId, 'snap-2'); s.controller.dispose();
});

test('connection stores resolved snapshot ID instead of analysis job ID', async () => {
  const s = setup(); const jobId = 'job-unique';
  s.api.snapshotForConnection = async id => {
    assert.equal(id, jobId);
    return snapshot;
  };
  await s.controller.connect(s.folders[0], jobId, async value => value.snapshotId === snapshot.snapshotId);
  const bound = s.controller.context(s.folders[0]).binding;
  assert.equal(bound.snapshotId, snapshot.snapshotId);
  assert.equal(s.store.read(s.folders[0].uri, s.api.backendIdentity).binding.snapshotId, snapshot.snapshotId);
  s.controller.dispose();
});
