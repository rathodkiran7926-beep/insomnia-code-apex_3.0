const test = require('node:test'); const assert = require('node:assert/strict');
const { registerCheckpointCommands, savedTaskItems, editor } = require('../.test-output/activation.cjs');
const { ComparisonContexts } = require('../.test-output/library.cjs');
const parent = { version: 1, workspaceUri: 'file:///repo', backendUrl: 'http://127.0.0.1:3001/', repositoryIdentity: 'https://github.com/a/b', snapshotId: 'current', indexedCommit: 'b'.repeat(40), connectedAt: 'saved' };
const ref = { id: 'ref0', snapshotId: 'old', file: 'a.ts', startLine: 1, endLine: 2, url: `https://github.com/a/b/blob/${'a'.repeat(40)}/a.ts#L1-L2` };
test('checkpoint Source/Map/Mentor and diff retain historical snapshots without overwriting current binding', async t => {
  const checkpoint = { id: 'checkpoint', snapshotId: 'old', repositoryIdentity: parent.repositoryIdentity, indexedCommit: 'a'.repeat(40), taskTitle: 'User title', sourceReferenceIds:['ref0'], localContext: { gitStatus: 'unknown' }, createdAt: '2026-10-24T00:00:00Z' };
  const detail = { checkpoint, snapshotAvailable: true, references: [ref], components: [{ id: 'c0', name: 'fn', role: 'function', referenceId: 'ref0' }], warnings: [] };
  const state = { viewId: 'view', binding: parent, detail, page: { items: [checkpoint] }, resume: { currentSnapshot: { ...parent, limitations: [] }, changes: { items: [{ referenceId: 'ref0', status: 'changed', currentReference: { ...ref, snapshotId: 'current', url: `https://github.com/a/b/blob/${parent.indexedCommit}/a.ts#L1-L2` } }] } } };
  const calls = []; const model = { state, current: id => { if (id !== state.viewId) throw new Error('stale'); return state; } };
  const temporary = new ComparisonContexts(() => parent, 'checkpoint'); temporary.setSession(parent, 'checkpoint');
  const subscriptions = [];
  const actions = registerCheckpointCommands({ subscriptions }, model, {}, temporary, { explainComponent: async target => calls.push(['mentor', target]) }, { show() {} }, { open: async target => calls.push(['map', target]) }, {}, { openReference: async (target, source) => calls.push(['source', target, source]), openDiff: async (...args) => calls.push(['diff', ...args]) }, () => undefined, () => parent, () => ({ gitStatus: 'unknown' }), async seed=>calls.push(['handoff',seed]));
  t.after(() => { for (const d of subscriptions) d.dispose(); temporary.dispose(); editor.testState.errors.length = 0; });
  for (const type of ['source', 'map', 'mentor', 'fileDiff']) await actions.perform(type, { viewId: 'view', referenceId: 'ref0', componentId: 'c0' });
  await actions.perform('handoff',{viewId:'view'}); const handoff=calls.find(c=>c[0]==='handoff')[1]; assert.equal(handoff.binding.snapshotId,'old');assert.equal(handoff.origin.checkpointId,'checkpoint');assert.deepEqual(handoff.sourceReferenceIds,['ref0']);
  for (const call of calls.filter(c => !['diff','handoff'].includes(c[0]))) assert.equal(call[1].snapshot.snapshotId, 'old');
  const diff = calls.find(c => c[0] === 'diff'); assert.equal(diff[1].snapshot.snapshotId, 'old'); assert.equal(diff[3].snapshot.snapshotId, 'current'); assert.equal(diff[5].before, 'saved checkpoint');
  assert.equal(temporary.bindingFor(parent.workspaceUri), parent);
  await assert.rejects(() => actions.perform('map', { viewId: 'view', referenceId: 'ref0', componentId: 'unknown' }));
  await assert.rejects(() => actions.perform('source', { viewId: 'obsolete', referenceId: 'ref0' }));
  let asked = false; editor.window.showWarningMessage = async () => { asked = true; return 'Delete checkpoint'; };
  await editor.testState.handlers.get('codebaseMentor.deleteCheckpoint')({ id: 'not-listed', viewId: 'view' });
  assert.equal(asked, false, 'Unknown IDs must not be presented as the selected checkpoint');
  await editor.testState.handlers.get('codebaseMentor.deleteCheckpoint')({ id: 'checkpoint', contextId: 'another-workspace' });
  assert.equal(asked, false, 'Native actions from another binding must not prompt deletion');
});
test('Focus displays backend task summaries, original commit and branch provenance with bounded navigation actions', () => {
  const rows = savedTaskItems({ status: 'ready', message: 'Saved tasks', viewId: 'view', binding: parent, page: { offset: 10, hasMore: true, items: [{ id: 'task', taskTitle: 'Original task title', snapshotId: 'old', repositoryIdentity: parent.repositoryIdentity, indexedCommit: 'a'.repeat(40), createdAt: '2026-10-24T00:00:00Z', localContext: { branch: 'saved-branch', gitStatus: 'clean' } }] } });
  const task = rows.find(r => r.contextValue === 'savedTask'); assert.match(task.description, /different saved snapshot/); assert.match(task.tooltip, /extension-reported/);
  assert.equal(task.command.command, 'codebaseMentor.resumeTask'); assert.equal(task.checkpointAction.id, 'task'); assert(rows.some(r => r.command?.command === 'codebaseMentor.previousCheckpoints'));
});

test('Saved Tasks uses binding-scoped actions and reads fresh children for a retained native group item', () => {
  const { MentorTree } = require('../.test-output/activation.cjs');
  let state = { status: 'ready', message: 'Saved tasks', viewId: 'old', binding: parent, page: { items: [{ id: 'task', taskTitle: 'Saved task', snapshotId: 'old', indexedCommit: 'a'.repeat(40), createdAt: '2026-10-24', localContext: {} }] } };
  const tree = new MentorTree('focus', () => ({ status: 'connected', message: 'Connected' }), undefined, undefined, undefined, () => state);
  const group = tree.getChildren().find(item => item.id === 'codebaseMentor.savedTasks');
  const oldAction = tree.getChildren(group).find(item => item.contextValue === 'savedTask').checkpointAction;
  assert.ok(oldAction.contextId); assert.equal(oldAction.viewId, undefined);
  state = { ...state, viewId: 'current' }; tree.refresh();
  assert.deepEqual(tree.getChildren(group).find(item => item.contextValue === 'savedTask').checkpointAction, oldAction);
  state = { ...state, page: { items: [] } }; tree.refresh();
  assert.equal(tree.getChildren(group).some(item => item.contextValue === 'savedTask'), false);
  tree.dispose();
});
