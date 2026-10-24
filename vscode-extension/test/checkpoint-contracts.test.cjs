const test = require('node:test'); const assert = require('node:assert/strict');
const c = require('../.test-output/library.cjs');
const repositoryIdentity = 'https://github.com/a/b', indexedCommit = 'a'.repeat(40);
const binding = { repositoryIdentity, indexedCommit, snapshotId: 'current' };
const localContext = { branch: ' main ', headCommit: indexedCommit, gitStatus: 'modified' };
const input = { requestId: '123e4567-e89b-42d3-a456-426614174000', snapshotId: 'current', taskTitle: ' Task ', notes: { discovery: ' exact\n', unresolved: '', nextStep: ' next ' }, localContext, sourceReferenceIds: ['ref'] };
function detail() { return { checkpoint: { id: 'cp', schemaVersion: 1, repositoryIdentity, snapshotId: 'current', indexedCommit, taskTitle: input.taskTitle, notes: input.notes, localContext, sourceReferenceIds: ['ref'], createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z' }, snapshotAvailable: true, references: [{ id: 'ref', snapshotId: 'current', file: 'src/a.ts', startLine: 1, endLine: 2, url: `${repositoryIdentity}/blob/${indexedCommit}/src/a.ts#L1-L2` }], components: [{ id: 'a', name: 'a', role: 'module', referenceId: 'ref' }], warnings: [] }; }
test('checkpoint input preserves approved blank and whitespace notes and rejects oversized or unsafe inputs', () => {
  assert.equal(typeof c.validateCheckpointInput, 'function');
  assert.deepEqual(c.validateCheckpointInput(input, binding), input);
  for (const bad of [{ ...input, snapshotId: 'other' }, { ...input, requestId: 'bad' }, { ...input, taskTitle: 'x'.repeat(201) }, { ...input, notes: { ...input.notes, discovery: 'x'.repeat(2001) } }, { ...input, localContext: { gitStatus: 'dirty' } }, { ...input, sourceReferenceIds: ['ref', 'ref'] }]) assert.throws(() => c.validateCheckpointInput(bad, binding));
});
test('checkpoint detail validates original saved citations and approved input echoes', () => {
  assert.equal(typeof c.validateCheckpointDetail, 'function');
  assert.deepEqual(c.validateCheckpointDetail(detail(), binding, 'cp', input), detail());
  const old = detail(); old.checkpoint.snapshotId = 'old'; old.references[0].snapshotId = 'old';
  assert.equal(c.validateCheckpointDetail(old, binding, 'cp').checkpoint.snapshotId, 'old');
  for (const mutate of [d => d.checkpoint.repositoryIdentity = 'https://github.com/other/repo', d => d.references[0].url = 'https://evil.test', d => d.components[0].referenceId = 'unknown', d => d.checkpoint.notes.discovery = 'rewritten']) { const d = structuredClone(detail()); mutate(d); assert.throws(() => c.validateCheckpointDetail(d, binding, 'cp', input)); }
});
test('checkpoint pages reject note leakage and resume validates file claims and current binding', () => {
  assert.equal(typeof c.validateCheckpointPage, 'function');
  const { notes, sourceReferenceIds, ...summary } = detail().checkpoint;
  const page = { repositoryIdentity, items: [summary], limit: 10, offset: 0, hasMore: false };
  assert.deepEqual(c.validateCheckpointPage(page, binding, 10, 0), page);
  assert.throws(() => c.validateCheckpointPage({ ...page, items: [detail().checkpoint] }, binding, 10, 0));
  const resume = { detail: detail(), currentSnapshot: { ...binding, limitations: [] }, currentLocalContext: localContext, versions: { indexed: 'same', localHead: 'same' }, changes: { status: 'verified', notice: 'File comparison only', items: [{ referenceId: 'ref', file: 'src/a.ts', status: 'unchanged', scope: 'file', notice: 'Exact file match', currentReference: detail().references[0] }] } };
  assert.deepEqual(c.validateCheckpointResume(resume, binding, 'cp', localContext), resume);
  for (const mutate of [r => r.currentSnapshot.snapshotId = 'wrong', r => r.changes.items[0].scope = 'semantic', r => r.changes.items[0].currentReference.url = 'https://evil.test', r => r.versions.indexed = 'different']) { const r = structuredClone(resume); mutate(r); assert.throws(() => c.validateCheckpointResume(r, binding, 'cp', localContext)); }
});
test('missing checkpoint evidence stays unavailable with a warning and unknown file result', () => {
  const saved = detail(); saved.references = []; saved.components = []; saved.warnings = ['Saved evidence is unavailable'];
  assert.equal(c.validateCheckpointDetail(saved, binding, 'cp').references.length, 0);
  saved.snapshotAvailable = false;
  const resume = { detail: saved, currentSnapshot: { ...binding, limitations: [] }, currentLocalContext: localContext, versions: { indexed: 'same', localHead: 'same' }, changes: { status: 'unavailable', notice: 'Unavailable evidence', items: [{ referenceId: 'ref', file: '(unavailable)', status: 'unknown', scope: 'file', notice: 'Saved evidence unavailable' }] } };
  assert.equal(c.validateCheckpointResume(resume, binding, 'cp', localContext).changes.items[0].status, 'unknown');
});
test('partly verified checkpoint files preserve known changes while overall comparison remains unavailable', () => {
  const saved = detail(); saved.checkpoint.sourceReferenceIds.push('missing'); saved.warnings.push('Saved source evidence unavailable');
  const resume = { detail: saved, currentSnapshot: { ...binding, limitations: [] }, currentLocalContext: localContext, versions: { indexed: 'same', localHead: 'same' }, changes: { status: 'unavailable', notice: 'Partly unverified', items: [{ referenceId: 'ref', file: 'src/a.ts', status: 'changed', scope: 'file', notice: 'Exact file comparison', currentReference: saved.references[0] }, { referenceId: 'missing', file: '(unavailable)', status: 'unknown', scope: 'file', notice: 'Unavailable evidence' }] } };
  assert.equal(c.validateCheckpointResume(resume, binding, 'cp', localContext).changes.items[0].status, 'changed');
});
test('verified changed and unchanged checkpoint files require a current pinned source reference', () => {
  for (const status of ['changed', 'unchanged']) {
    const resume = { detail: detail(), currentSnapshot: { ...binding, limitations: [] }, currentLocalContext: localContext, versions: { indexed: 'same', localHead: 'same' }, changes: { status: 'verified', notice: 'File comparison', items: [{ referenceId: 'ref', file: 'src/a.ts', status, scope: 'file', notice: 'Complete file comparison' }] } };
    assert.throws(() => c.validateCheckpointResume(resume, binding, 'cp', localContext));
  }
});
