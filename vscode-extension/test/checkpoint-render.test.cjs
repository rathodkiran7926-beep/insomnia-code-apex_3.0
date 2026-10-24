const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { renderCheckpointBody } = require('../.test-output/library.cjs');

const binding = { backendUrl: 'http://127.0.0.1:3001/', repositoryIdentity: 'https://github.com/a/b', snapshotId: 'saved-snapshot', indexedCommit: 'a'.repeat(40) };
const localContext = { branch: 'topic', headCommit: 'b'.repeat(40), gitStatus: 'modified' };
const reference = { id: 'ref-a', snapshotId: binding.snapshotId, file: 'src/a.ts', startLine: 3, endLine: 8, url: 'https://github.com/a/b/blob/aaa/src/a.ts#L3-L8', excerpt: 'SECRET SOURCE CONTENT' };
const state = { status: 'ready', message: 'Ready', viewId: 'view-1', binding };
const input = { requestId: 'request-1', snapshotId: binding.snapshotId, taskTitle: '  A title  ', notes: { discovery: '  <script>bad()</script>\nnext  ', unresolved: '', nextStep: '  continue\n  here  ' }, localContext, sourceReferenceIds: ['ref-a'] };
const draft = { id: 'draft-1', mode: 'edit', binding, localContext, choices: [{ reference }], notice: 'Local single-user storage.' };
const detail = { checkpoint: { id: 'saved-1', schemaVersion: 1, ...binding, taskTitle: input.taskTitle, notes: input.notes, localContext, sourceReferenceIds: ['ref-a'], createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z' }, snapshotAvailable: true, references: [reference], components: [{ id: 'component-1', name: 'A', role: 'function', referenceId: 'ref-a' }], warnings: [] };

test('disabled checkpoint creation is unavailable and busy drafts remain cancellable', () => {
  const disabled = renderCheckpointBody({ ...state, status: 'disabled', capability: { enabled: false, notice: 'Disabled' } });
  assert.match(disabled, /data-action="new"[^>]* disabled>/);
  const busy = renderCheckpointBody({ ...state, status: 'saving' }, { ...draft, mode: 'preview', input });
  assert.match(busy, /data-action="cancel"[^>]*data-view="view-1">/);
  assert.doesNotMatch(busy, /data-action="cancel"[^>]* disabled>/);
  assert.doesNotMatch(renderCheckpointBody({ ...state, status: 'loading' }), /No saved checkpoints to show/);
});

test('checkpoint draft DOM survives safe revalidation and clears on an actual context change', () => {
  const { CheckpointPanel, editor } = require('../.test-output/activation.cjs');
  const original = editor.window.createWebviewPanel, messages = [];
  let receive, changed, active = binding, recoverable = binding;
  editor.window.createWebviewPanel = () => ({ reveal() {}, onDidDispose: () => ({ dispose() {} }), webview: { asWebviewUri: uri => uri, postMessage: message => messages.push(message), onDidReceiveMessage: handler => { receive = handler; return { dispose() {} }; } } });
  try {
    const controller = { state, onChange: handler => { changed = handler; return { dispose() {} }; } };
    const panel = new CheckpointPanel(editor.Uri.parse('file:///extension'), controller, { binding: () => active, recoverableBinding: () => recoverable, perform: async () => {} });
    panel.edit(draft); receive({ type: 'ready' });
    const draftId = panel.draft.id;
    active = undefined; changed();
    assert.equal(panel.draft.id, draftId);
    assert.equal(messages.at(-1).type, 'status');
    assert.equal(messages.at(-1).unavailable, true);
    active = binding; changed();
    assert.equal(messages.at(-1).unavailable, false);
    recoverable = undefined; active = undefined; changed();
    assert.equal(panel.draft, undefined);
  } finally { editor.window.createWebviewPanel = original; }
});

test('checkpoint edit starts with empty optional notes and previews before offering Save', () => {
  const html = renderCheckpointBody(state, draft);
  assert.match(html, /id="checkpoint-draft"/);
  assert.match(html, /name="taskTitle"[^>]*maxlength="200"[^>]*required/);
  for (const name of ['discovery', 'unresolved', 'nextStep']) assert.match(html, new RegExp('name="' + name + '"[^>]*maxlength="2000"[^>]*></textarea>'));
  assert.match(html, /value="ref-a" checked/);
  assert.match(html, /Preview/);
  assert.doesNotMatch(html, /data-action="save"|SECRET SOURCE CONTENT/);
  assert.match(html, /Backend-verified indexed metadata/);
  assert.match(html, /Extension-reported Git/);
});

test('checkpoint preview preserves exact authored whitespace, escapes markup and requires explicit Save', () => {
  const html = renderCheckpointBody(state, { ...draft, mode: 'preview', input });
  assert.match(html, /  A title  /);
  assert.ok(html.includes('  &lt;script&gt;bad()&lt;/script&gt;\nnext  '));
  assert.ok(html.includes('  continue\n  here  '));
  assert.match(html, /class="answer"/);
  assert.match(html, /User-authored/);
  assert.match(html, /src\/a.ts:3/);
  assert.match(html, /data-action="save" data-draft="draft-1"/);
  assert.match(html, /data-action="edit"/);
  assert.doesNotMatch(html, /<script>|SECRET SOURCE CONTENT/);
});

test('checkpoint resume keeps original notes and labels only verified file-level change evidence', () => {
  const resume = { detail, currentSnapshot: { ...binding, snapshotId: 'new-snapshot', indexedCommit: 'c'.repeat(40), limitations: [] }, currentLocalContext: localContext, versions: { indexed: 'different', localHead: 'same' }, changes: { status: 'unavailable', notice: 'Original snapshot unavailable.', items: [{ referenceId: 'ref-a', file: 'src/a.ts', status: 'unknown', scope: 'file', notice: 'File comparison unavailable.' }] } };
  const html = renderCheckpointBody({ ...state, detail, resume });
  for (const heading of ['What you saved', 'Repository state', 'Changes since checkpoint', 'Continue working']) assert.ok(html.includes(heading));
  assert.ok(html.includes('  &lt;script&gt;bad()&lt;/script&gt;\nnext  '));
  assert.match(html, /File status: unknown/);
  assert.match(html, /Indexed commit status: different/);
  assert.match(html, /Snapshot status: different/);
  assert.match(html, /saved-snapshot/);
  assert.match(html, /new-snapshot/);
  assert.match(html, /Original snapshot unavailable/);
  assert.match(html, /Review Changes unavailable/);
  assert.doesNotMatch(html, /data-action="changes"|SECRET SOURCE CONTENT|<script>/);
  for (const action of ['source', 'map', 'mentor']) assert.ok(html.includes('data-action="' + action + '"'));
  assert.match(html, /data-view="view-1"/);
  assert.match(html, /data-reference="ref-a"/);
  const linked = renderCheckpointBody({ ...state, resume: { ...resume, comparison: { id: 'comparison-1', beforeSnapshotId: binding.snapshotId, afterSnapshotId: 'new-snapshot', prUrl: 'https://github.com/a/b/pull/1' } } });
  assert.match(linked, /data-action="changes"/);
});

function scriptHarness() {
  const posted = [], handlers = {}, root = { innerHTML: '', dataset: {} }, documentElement = { dataset: {} };
  const document = { documentElement, getElementById: id => id === 'checkpoint-root' ? root : undefined, addEventListener: (type, fn) => { handlers[type] = fn; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../media/checkpoints.js'), 'utf8'), { acquireVsCodeApi: () => ({ postMessage: item => posted.push(JSON.parse(JSON.stringify(item))) }), document, window: { addEventListener: (type, fn) => { handlers['window-' + type] = fn; } } });
  return { posted, handlers, root, documentElement };
}

test('checkpoint stored file diff is offered only for verified statuses with both source references', () => {
  const render = (status, currentReference, references = [reference]) => renderCheckpointBody({ ...state, resume: { detail: { ...detail, references }, currentSnapshot: { ...binding, limitations: [] }, currentLocalContext: localContext, versions: { indexed: 'same', localHead: 'same' }, changes: { status: status === 'unknown' ? 'unavailable' : 'verified', notice: 'Stored file text comparison.', items: [{ referenceId: 'ref-a', file: reference.file, scope: 'file', status, notice: 'Stored indexed text only.', currentReference }] } } });
  for (const status of ['changed', 'unchanged']) {
    const html = render(status, { ...reference, id: 'current-ref' });
    assert.match(html, /data-action="fileDiff" data-reference="ref-a" data-view="view-1"/);
    assert.match(html, /Review stored file diff/);
  }
  assert.doesNotMatch(render('unknown', reference), /data-action="fileDiff"/);
  assert.doesNotMatch(render('changed', undefined), /data-action="fileDiff"/);
  assert.doesNotMatch(render('changed', reference, []), /data-action="fileDiff"/);
  const harness = scriptHarness();
  harness.handlers.click({ target: { closest: () => ({ disabled: false, dataset: { action: 'fileDiff', view: 'view-1', reference: 'ref-a' } }) } });
  assert.deepEqual(harness.posted[1], { type: 'fileDiff', viewId: 'view-1', referenceId: 'ref-a' });
});

test('checkpoint shell handshakes and renders without initiating Save or source reads', () => {
  const harness = scriptHarness();
  assert.deepEqual(harness.posted, [{ type: 'ready' }]);
  harness.handlers['window-message']({ data: { type: 'render', body: '<main>Ready</main>' } });
  assert.equal(harness.root.innerHTML, '<main>Ready</main>');
  assert.equal(harness.root.dataset.checkpointReady, 'true');
  assert.equal(harness.documentElement.dataset.checkpointReady, 'true');
  assert.equal(harness.posted.length, 1);
});

test('checkpoint submit sends exact authored fields and only selected reference IDs for host preview', () => {
  const harness = scriptHarness();
  const fields = { taskTitle: { value: input.taskTitle }, discovery: { value: input.notes.discovery }, unresolved: { value: '' }, nextStep: { value: input.notes.nextStep } };
  const form = { id: 'checkpoint-draft', dataset: { draft: 'draft-1' }, elements: { namedItem: name => fields[name] }, querySelectorAll: () => [{ value: 'ref-a' }], checkValidity: () => true };
  let prevented = false;
  harness.handlers.submit({ target: form, preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  assert.deepEqual(harness.posted[1], { type: 'preview', draftId: 'draft-1', fields: { taskTitle: input.taskTitle, notes: input.notes, sourceReferenceIds: ['ref-a'] } });
  harness.handlers.click({ target: { closest: () => ({ disabled: false, dataset: { action: 'save', draft: 'draft-1', view: 'view-1' } }) } });
  assert.deepEqual(harness.posted[2], { type: 'save', draftId: 'draft-1', viewId: 'view-1' });
});
