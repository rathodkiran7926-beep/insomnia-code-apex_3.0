const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MentorController, ApiError } = require('../.test-output/library.cjs');
const sha = 'a'.repeat(40);
const component = { id: 'c0', name: 'first', role: 'function', referenceId: 'ref0' };
const ref = { id: 'ref0', snapshotId: 'snap', file: 'src/a.ts', startLine: 1, endLine: 3, url: `https://github.com/a/b/blob/${sha}/src/a.ts#L1-L3` };
const evidence = { snapshotId: 'snap', repositoryIdentity: 'https://github.com/a/b', indexedCommit: sha, limitations: [], components: [component], references: [ref] };
const binding = { ...evidence, version: 1, workspaceUri: 'file:///repo', backendUrl: 'http://127.0.0.1:3001/' };
function setup() {
  let editor = { workspaceUri: binding.workspaceUri, repositoryRootUri: binding.workspaceUri, documentUri: 'file:///repo/src/a.ts', documentVersion: 1, file: 'src/a.ts', selection: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, hasSelection: false, hasUnsavedChanges: false, binding, revision: 'matched' };
  let currentBinding = binding; let trusted = true; let verified = true; let allow = true; let calls = []; let error;
  const api = { backendIdentity: binding.backendUrl,
    evidence: async id => { calls.push(['evidence', id]); if (error) throw error; return evidence; },
    resolveSelection: async (_evidence, file, start, end) => { calls.push(['resolve', file, start, end]); return { snapshotId: 'snap', candidates: [{ componentId: 'c0', name: 'first', role: 'function', referenceId: 'ref0' }], scope: 'declaration', notice: 'Enclosing component' }; },
    question: async (_evidence, id, question) => { calls.push(['question', id, question]); return { snapshotId: 'snap', componentId: id, answer: 'Grounded answer', mode: 'facts', notice: 'Source facts only', referenceIds: ['ref0'], citations: [ref] }; },
  };
  const env = { editor: () => editor, binding: () => currentBinding, trusted: () => trusted,
    choose: async candidates => candidates[0], verified: async () => verified, acknowledge: async () => { calls.push(['acknowledge']); return allow; } };
  const controller = new MentorController(api, env);
  return { controller, api, env, calls, setEditor: value => { editor = value; }, editor: () => editor, setBinding: value => { currentBinding = value; }, setTrusted: value => { trusted = value; }, setVerified: value => { verified = value; }, setAllow: value => { allow = value; }, setError: value => { error = value; } };
}
test('Explain Selection sends only snapshot/file/line metadata and asks existing component Q&A', async () => {
  const s = setup(); await s.controller.explain();
  assert.equal(s.controller.state.status, 'ready'); assert.equal(s.controller.state.result.component.name, 'first');
  assert.deepEqual(s.calls[1], ['resolve', 'src/a.ts', 2, 2]);
  assert.equal(s.calls[2][0], 'question'); assert.equal(s.calls[2][1], 'c0');
  assert.equal(s.controller.state.result.answer.mode, 'facts'); s.controller.dispose();
});
test('trust, missing binding and changed backend prevent all Mentor requests', async () => {
  const s = setup(); s.setTrusted(false); await s.controller.explain(); assert.equal(s.calls.length, 0);
  s.setTrusted(true); s.setBinding(undefined); await s.controller.explain(); assert.equal(s.calls.length, 0);
  s.setBinding(binding); s.api.backendIdentity = 'https://another.example/'; await s.controller.explain(); assert.equal(s.calls.length, 0); s.controller.dispose();
});
test('different, dirty or unverified source requires explicit indexed-source acknowledgement', async () => {
  const s = setup(); s.setVerified(false); s.setAllow(false); await s.controller.explain();
  assert.equal(s.controller.state.status, 'cancelled'); assert.equal(s.calls.filter(call => call[0] === 'question').length, 0);
  s.setAllow(true); await s.controller.explain(); assert.equal(s.controller.state.result.indexedOnly, true);
  assert.equal(s.calls.filter(call => call[0] === 'acknowledge').length, 2); s.controller.dispose();
});
test('zero candidates shows an honest empty state and multiple candidates invoke the picker', async () => {
  const s = setup(); s.api.resolveSelection = async () => ({ snapshotId: 'snap', candidates: [], scope: 'none', notice: 'No supported component' });
  await s.controller.explain(); assert.equal(s.controller.state.status, 'empty');
  let picked = false; s.env.choose = async candidates => { picked = true; return candidates[1]; };
  s.api.resolveSelection = async () => ({ snapshotId: 'snap', candidates: [{ componentId: 'c0', ...component }, { componentId: 'c0', ...component }], scope: 'declaration', notice: 'Choose indexed component' });
  await s.controller.explain(); assert.equal(picked, true); s.controller.dispose();
});
test('follow-up retains pinned component, history and previous answer on rate limiting', async () => {
  const s = setup(); await s.controller.explain(); const initial = s.controller.state.result.id;
  await s.controller.ask('Why is this necessary?'); assert.equal(s.calls.at(-1)[1], 'c0'); assert.equal(s.calls.at(-1)[2], 'Why is this necessary?');
  s.controller.previous(); assert.equal(s.controller.state.result.id, initial);
  s.setError(new ApiError('http', 'Busy', 429)); await s.controller.ask('What inputs?');
  assert.equal(s.controller.state.result.id, initial); assert.match(s.controller.state.message, /busy|429/i);
  s.setBinding(undefined); s.controller.contextChanged(); assert.equal(s.controller.selectedContext(), undefined);
  assert.match(s.controller.state.message, /binding/); const count = s.calls.length; await s.controller.ask('Another question'); assert.equal(s.calls.length, count); s.controller.dispose();
});
test('late answers and editor changes cannot replace the newer explanation', async () => {
  const s = setup(); let finish; let oldSignal;
  const normal = s.api.question;
  s.api.question = (_evidence, id, question, signal) => { oldSignal = signal; return new Promise(resolve => { finish = resolve; }); };
  const first = s.controller.explain(); await new Promise(resolve => setImmediate(resolve));
  s.setEditor({ ...s.editor(), selection: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } } }); s.controller.contextChanged();
  assert.equal(oldSignal.aborted, true);
  s.api.question = normal; await s.controller.explain(); const latest = s.controller.state.result.id;
  finish({ snapshotId: 'snap', componentId: 'c0', answer: 'Old', mode: 'facts', notice: 'old', referenceIds: ['ref0'], citations: [ref] }); await first;
  assert.equal(s.controller.state.result.id, latest); s.controller.dispose();
});
test('user cancellation and disposal abort work without destroying a previous valid answer', async () => {
  const s = setup(); await s.controller.explain(); const old = s.controller.state.result;
  let signal; let finish;
  s.api.evidence = (_id, value) => { signal = value; return new Promise(resolve => { finish = resolve; }); };
  const pending = s.controller.ask('Follow-up'); s.controller.cancel(); assert.equal(signal.aborted, true);
  finish(evidence); await pending; assert.equal(s.controller.state.result.id, old.id);
  s.controller.dispose();
});
test('Explain Retry uses a newly selected file and history browsing clears stale follow-up retries', async () => {
  const s = setup(); s.setError(new ApiError('network', 'Offline')); await s.controller.explain();
  s.setError(undefined); s.setEditor({ ...s.editor(), file: 'src/new.ts', documentUri: 'file:///repo/src/new.ts' });
  await s.controller.retry(); assert.ok(s.calls.some(call => call[0] === 'resolve' && call[1] === 'src/new.ts'));
  await s.controller.ask('Second answer');
  s.setError(new ApiError('http', 'Busy', 429)); await s.controller.ask('Failed follow-up');
  s.controller.previous(); const count = s.calls.length; await s.controller.retry(); assert.equal(s.calls.length, count); s.controller.dispose();
});
test('HEAD or file modification changes during Q&A invalidate a formerly verified explanation', async () => {
  const s = setup(); let signal; let finish;
  s.api.question = (_evidence, _id, _question, value) => { signal = value; return new Promise(resolve => { finish = resolve; }); };
  const pending = s.controller.explain(); await new Promise(resolve => setImmediate(resolve));
  s.setEditor({ ...s.editor(), revision: 'different', localHead: 'b'.repeat(40), fileModified: true }); s.controller.contextChanged();
  assert.equal(signal.aborted, true);
  finish({}); await pending; assert.equal(s.controller.state.result, undefined); s.controller.dispose();
});
test('pinned source version changes cancel follow-ups even when the webview owns focus', async () => {
  const s = setup(); let version = 'head-a'; s.env.sourceVersion = () => version;
  await s.controller.explain(); s.setEditor(undefined);
  let signal; let finish; s.api.question = (_evidence, _id, _question, value) => { signal = value; return new Promise(resolve => { finish = resolve; }); };
  const pending = s.controller.ask('Why?'); await new Promise(resolve => setImmediate(resolve));
  version = 'head-b'; s.controller.contextChanged(); assert.equal(signal.aborted, true);
  finish({}); await pending; s.controller.dispose();
});
test('a follow-up input opened for an earlier answer cannot ask against a newly selected answer', async () => {
  const s = setup(); await s.controller.explain(); const inputTarget = s.controller.state.result.id;
  await s.controller.ask('Another answer'); const before = s.calls.length;
  await s.controller.ask('Question entered for the old answer', inputTarget);
  assert.equal(s.calls.length, before); assert.match(s.controller.state.message, /answer changed/i); s.controller.dispose();
});
