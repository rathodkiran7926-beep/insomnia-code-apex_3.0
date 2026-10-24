const test = require('node:test'); const assert = require('node:assert/strict');
const { ComparisonContexts } = require('../.test-output/library.cjs');
const parent = { version: 1, workspaceUri: 'file:///repo', snapshotId: 'workspace', backendUrl: 'http://127.0.0.1:3001/', repositoryIdentity: 'https://github.com/a/b', indexedCommit: 'a'.repeat(40), connectedAt: 'saved' };
test('comparison sides remain temporary, independently pinned and never overwrite persistent bindings', () => {
  let current = parent; const registry = new ComparisonContexts(uri => current);
  registry.setSession(parent, 'comparison');
  const before = registry.create(parent, 'comparison', { snapshotId: 'before', repositoryIdentity: parent.repositoryIdentity, indexedCommit: 'b'.repeat(40), limitations: [] }, 'before');
  const after = registry.create(parent, 'comparison', { snapshotId: 'after', repositoryIdentity: 'https://github.com/fork/b', indexedCommit: 'c'.repeat(40), limitations: [] }, 'after');
  assert.equal(registry.bindingFor(parent.workspaceUri).snapshotId, 'workspace');
  assert.equal(registry.bindingFor(parent.workspaceUri, before).snapshotId, 'before'); assert.equal(registry.bindingFor(parent.workspaceUri, after).repositoryIdentity, 'https://github.com/fork/b');
  assert.equal(current, parent); current = { ...parent, snapshotId: 'new' }; assert.notEqual(registry.bindingFor(parent.workspaceUri, before).snapshotId, 'before');
});
test('comparison switch and disposal invalidate old side tokens', () => {
  const registry = new ComparisonContexts(() => parent); registry.setSession(parent, 'old');
  const temp = registry.create(parent, 'old', { snapshotId: 'before', repositoryIdentity: parent.repositoryIdentity, indexedCommit: 'b'.repeat(40), limitations: [] }, 'before');
  registry.setSession(parent, 'new'); assert.notEqual(registry.bindingFor(parent.workspaceUri, temp).snapshotId, 'before');
  assert.throws(() => registry.create(parent, 'old', { snapshotId: 'before' }, 'before')); registry.dispose();
});
