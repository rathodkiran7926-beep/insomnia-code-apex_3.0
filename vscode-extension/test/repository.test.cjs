const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGithubRemote, compareRepository, BindingStore, validateSnapshot, MentorApi } = require('../.test-output/library.cjs');
const sha = 'a'.repeat(40);
const snapshot = { snapshotId: 'snap-1', repository: 'https://github.com/Owner/Repo', commit: sha, components: [], references: [], relationships: [], report: { limitations: ['Static only'] }, documentation: { snapshotId: 'snap-1' } };
const binding = { version: 1, workspaceUri: 'file:///repo', snapshotId: 'snap-1', backendUrl: 'http://127.0.0.1:3001/', repositoryIdentity: 'https://github.com/owner/repo', indexedCommit: sha, connectedAt: '2026-10-24T00:00:00.000Z' };
function memory() { const values = new Map(); return { get: key => values.get(key), update: async (key, value) => { if (value === undefined) values.delete(key); else values.set(key, value); } }; }

test('GitHub HTTPS and SSH identity normalization removes credentials and canonicalizes case', () => {
  for (const remote of ['https://github.com/Owner/Repo.git', 'https://token:secret@github.com/Owner/Repo/', 'git@github.com:Owner/Repo.git', 'ssh://git@github.com/Owner/Repo.git']) {
    assert.equal(normalizeGithubRemote(remote), 'https://github.com/owner/repo');
  }
  for (const remote of ['https://github.com.evil/owner/repo', 'https://github.com/owner/../repo', 'https://github.com/a/b/tree/main', 'file:///repo', 'ssh://git@evil.com/a/b', 'not a URL', 'https://github.com/a/b?secret=x']) assert.equal(normalizeGithubRemote(remote), undefined);
});
test('repository identity is independent from revision and dirty state', () => {
  const local = { identity: 'https://github.com/owner/repo', head: sha, dirty: true };
  assert.deepEqual(compareRepository(local, binding), { identity: 'matched', revision: 'matched', localChanges: true });
  assert.equal(compareRepository({ ...local, head: 'b'.repeat(40) }, binding).revision, 'different');
  assert.equal(compareRepository({ ...local, head: 'aaaaaaa' }, binding).revision, 'unknown');
  assert.equal(compareRepository({}, binding).identity, 'unverified');
  assert.equal(compareRepository({}, binding).revision, 'unknown');
  assert.equal(compareRepository({ ...local, identity: 'https://github.com/other/repo' }, binding).identity, 'mismatch');
  assert.equal(compareRepository({ ...local, identity: 'https://github.com/other/repo' }, binding).revision, 'unknown');
});
test('snapshot metadata validates the real contract and discards graph/source contents', () => {
  assert.deepEqual(validateSnapshot(snapshot, 'snap-1'), { snapshotId: 'snap-1', repositoryIdentity: 'https://github.com/owner/repo', indexedCommit: sha, limitations: ['Static only'] });
  for (const invalid of [null, {}, { ...snapshot, snapshotId: 'other' }, { ...snapshot, commit: 'short' }, { ...snapshot, repository: 'https://evil.com/a/b' }, { ...snapshot, documentation: { snapshotId: 'other' } }, { ...snapshot, report: {} }, { ...snapshot, components: null }]) assert.throws(() => validateSnapshot(invalid, 'snap-1'));
});
test('bindings persist independently across restart and reject backend changes and malformed records', async () => {
  const storage = memory(); const store = new BindingStore(storage);
  await store.save(binding); await store.save({ ...binding, workspaceUri: 'file:///second', snapshotId: 'snap-2' });
  const restarted = new BindingStore(storage);
  assert.equal(restarted.read('file:///repo', binding.backendUrl).binding.snapshotId, 'snap-1');
  assert.equal(restarted.read('file:///repo', 'http://127.0.0.1:3002/').status, 'other-backend');
  assert.equal(restarted.read('file:///repo', 'http://127.0.0.1:3001/proxy/').status, 'other-backend');
  await restarted.remove('file:///repo');
  assert.equal(restarted.read('file:///repo', binding.backendUrl).status, 'none');
  assert.equal(restarted.read('file:///second', binding.backendUrl).binding.snapshotId, 'snap-2');
  await storage.update(store.key('file:///repo'), { ...binding, version: 99 });
  assert.equal(store.read('file:///repo', binding.backendUrl).status, 'invalid');
});
test('snapshot ID input is rejected before network and backend prefixes are isolated', async () => {
  const api = new MentorApi(() => 'http://127.0.0.1:3001/proxy');
  assert.equal(api.backendIdentity, 'http://127.0.0.1:3001/proxy/');
  for (const id of ['', '../secret', 'a/b', 'bad?id', ' '.repeat(5), 'x'.repeat(151)]) await assert.rejects(api.snapshot(id), error => error.kind === 'configuration');
});
