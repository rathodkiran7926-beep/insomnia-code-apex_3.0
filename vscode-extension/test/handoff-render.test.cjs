const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { renderHandoffBody } = require('../.test-output/library.cjs');
const binding = { backendUrl: 'http://127.0.0.1:3001/', repositoryIdentity: 'https://github.com/a/b', snapshotId: 'snapshot', indexedCommit: 'a'.repeat(40) };
const state = { status: 'ready', message: 'Ready', viewId: 'view-1', binding };
const input = { snapshotId: 'snapshot', sourceReferenceIds: ['ref-a'], question: '', attemptedSteps: '', additionalContext: '', origin: { type: 'editor' } };
const draft = { id: 'draft-1', binding, input, mode: 'compose' };
const reference = { id: 'ref-a', snapshotId: 'snapshot', file: 'src/a.ts', startLine: 1, endLine: 3, url: 'https://github.com/a/b/blob/aaa/src/a.ts#L1-L3', excerpt: 'UNAPPROVED SOURCE' };
const selection = { referenceIds: ['ref-a'], relationshipIds: [], excerptReferenceIds: [], includeDocumentation: false, includeCheckpointNotes: false };
const markdown = '  # Question\n<script>bad()</script>\n[link](javascript:bad)  ';
const context = { ...input, schemaVersion: 1, repositoryIdentity: binding.repositoryIdentity, indexedCommit: binding.indexedCommit, references: [reference], components: [], relationships: [], documentation: [], excerpts: [], limitations: ['Only indexed evidence.'], warnings: [] };
const preview = { input: { ...input, question: '  Why?  ' }, selection, context, candidates: { references: [reference], components: [], relationships: [{ id: 'edge', source: 'a', target: 'b', type: 'calls', referenceId: 'ref-a' }], documentation: [], checkpointNotesAvailable: true }, markdown, digest: 'a'.repeat(64) };

test('handoff compose is empty, bounded and names the destination before explicit preview', () => {
  const html = renderHandoffBody(state, draft);
  assert.match(html, /http:\/\/127\.0\.0\.1:3001\//);
  assert.match(html, /name="question"[^>]*maxlength="1500"[^>]*required[^>]*><\/textarea>/);
  for (const name of ['attemptedSteps', 'additionalContext']) assert.match(html, new RegExp('name="' + name + '"[^>]*maxlength="2000"[^>]*><\/textarea>'));
  assert.match(html, /Build Preview/);
  assert.match(html, /Source excerpts are off/);
  assert.doesNotMatch(html, /data-action="save"|UNAPPROVED SOURCE/);
});

test('handoff review preserves canonical markdown, offers explicit selection and defaults sensitive options off', () => {
  const html = renderHandoffBody({ ...state, preview }, { ...draft, mode: 'review', preview });
  assert.ok(html.includes('<pre class="answer">  # Question\n&lt;script&gt;bad()&lt;/script&gt;\n[link](javascript:bad)  </pre>'));
  assert.match(html, /name="referenceIds" value="ref-a" checked/);
  for (const name of ['excerptReferenceIds', 'includeDocumentation', 'includeCheckpointNotes']) assert.doesNotMatch(html, new RegExp('name="' + name + '"[^>]*checked'));
  assert.match(html, /up to 4/);
  assert.match(html, /Apply selection/);
  assert.match(html, /data-action="save" data-draft="draft-1" data-view="view-1"/);
  assert.doesNotMatch(html, /<script>|UNAPPROVED SOURCE|href="javascript/);
  const stale = renderHandoffBody(state, { ...draft, mode: 'review' });
  assert.doesNotMatch(stale, /data-action="save"/);
});

test('Save requires a ready current preview object, including after failed or superseded refinement', () => {
  const review = { ...draft, mode: 'review', preview };
  for (const status of ['loading', 'saving', 'error', 'cancelled', 'disabled', 'idle']) {
    const html = renderHandoffBody({ ...state, status, preview }, review);
    assert.match(html, /data-action="save"[^>]* disabled>/);
  }
  for (const current of [undefined, { ...preview }]) {
    const html = renderHandoffBody({ ...state, preview: current }, review);
    assert.match(html, /data-action="save"[^>]* disabled>/);
  }
  const ready = renderHandoffBody({ ...state, preview }, review);
  assert.match(ready, /data-action="save" data-draft="draft-1" data-view="view-1">/);
});

test('saved handoffs show stored evidence and manual export controls without delivery claims', () => {
  const html = renderHandoffBody({ ...state, detail: { id: 'saved-1', schemaVersion: 1, status: 'ready', createdAt: 'today', updatedAt: 'today', context, markdown, digest: preview.digest } });
  for (const action of ['copy', 'export', 'source', 'delete', 'new', 'refresh']) assert.ok(html.includes('data-action="' + action + '"'));
  assert.match(html, /data-handoff="saved-1"/);
  assert.match(html, /data-reference="ref-a"/);
  assert.match(html, /Only indexed evidence/);
  assert.match(html, /Manual export/);
  assert.doesNotMatch(html, /<script>|UNAPPROVED SOURCE/);
});

test('review preserves approved selection and escapes every untrusted candidate label and identifier', () => {
  const unsafe = '\"><img src=x onerror=bad()>';
  const selectedPreview = { ...preview, selection: { ...selection, relationshipIds: ['edge'], excerptReferenceIds: ['ref-a'], includeDocumentation: true, includeCheckpointNotes: true }, candidates: { ...preview.candidates, references: [{ ...reference, file: unsafe }], documentation: [{ componentId: 'a', explanation: 'inferred', inferred: true, referenceIds: ['ref-a'] }] } };
  const html = renderHandoffBody({ ...state, message: unsafe }, { ...draft, id: unsafe, mode: 'review', preview: selectedPreview });
  for (const name of ['relationshipIds', 'excerptReferenceIds', 'includeDocumentation', 'includeCheckpointNotes']) assert.match(html, new RegExp('name="' + name + '"[^>]*checked'));
  assert.doesNotMatch(html, /<img|<script/);
  assert.ok(html.includes('&quot;&gt;&lt;img src=x onerror=bad()&gt;'));
  const compose = renderHandoffBody(state, { ...draft, input: { ...input, question: '  question\n ', attemptedSteps: '  tried\n ', additionalContext: unsafe } });
  assert.ok(compose.includes('>  question\n </textarea>'));
  assert.ok(compose.includes('>  tried\n </textarea>'));
  assert.doesNotMatch(compose, /<img/);
});

function harness() {
  const posted = [], handlers = {}, root = { innerHTML: '', dataset: {} }, status = { textContent: '', dataset: {} }, documentElement = { dataset: {} };
  const save = { disabled: false };
  const document = { documentElement, querySelector: () => save, getElementById: id => id === 'handoff-root' ? root : status, addEventListener: (type, fn) => { handlers[type] = fn; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../media/handoffs.js'), 'utf8'), { acquireVsCodeApi: () => ({ postMessage: value => posted.push(JSON.parse(JSON.stringify(value))) }), document, window: { addEventListener: (type, fn) => { handlers['window-' + type] = fn; } } });
  return { posted, handlers, root, status, documentElement, save };
}

test('handoff script handshakes, status updates preserve compose DOM and action messages carry guards', () => {
  const h = harness();
  assert.deepEqual(h.posted, [{ type: 'ready' }]);
  h.root.innerHTML = '<form>unsent text</form>';
  h.handlers['window-message']({ data: { type: 'status', status: 'error', message: '<bad>' } });
  assert.equal(h.root.innerHTML, '<form>unsent text</form>');
  assert.equal(h.status.textContent, '<bad>');
  h.handlers['window-message']({ data: { type: 'render', body: '<main>Ready</main>' } });
  assert.equal(h.documentElement.dataset.handoffReady, 'true');
  h.handlers.click({ target: { closest: () => ({ disabled: false, dataset: { action: 'save', view: 'view-1', draft: 'draft-1' } }) } });
  assert.deepEqual(h.posted[1], { type: 'save', viewId: 'view-1', draftId: 'draft-1' });
});

test('changing review selection disables Save until a fresh backend preview is rendered', () => {
  const h = harness();
  h.handlers.change({ target: { closest: () => ({ id: 'handoff-selection' }) } });
  assert.equal(h.save.disabled, true);
  assert.deepEqual(h.posted, [{ type: 'ready' }]);
});

test('handoff script sends exact fields and bounded explicit selection only on submit', () => {
  const h = harness();
  const fields = { question: { value: '  Why?\n  ' }, attemptedSteps: { value: '  tried  ' }, additionalContext: { value: '' } };
  const form = { id: 'handoff-compose', dataset: { view: 'view-1', draft: 'draft-1' }, checkValidity: () => true, elements: { namedItem: name => fields[name] } };
  h.handlers.submit({ target: form, preventDefault() {} });
  assert.deepEqual(h.posted[1], { type: 'preview', viewId: 'view-1', draftId: 'draft-1', fields: { question: fields.question.value, attemptedSteps: fields.attemptedSteps.value, additionalContext: '' } });
  fields.question.value = 'x'.repeat(1501);
  h.handlers.submit({ target: form, preventDefault() {} });
  assert.equal(h.posted.length, 2);
  const selected = { referenceIds: ['ref-a'], relationshipIds: [], excerptReferenceIds: [] };
  const review = { id: 'handoff-selection', dataset: form.dataset, checkValidity: () => true, elements: { namedItem: () => ({ checked: false }) }, querySelectorAll: query => (selected[query.match(/name="([^"]+)/)[1]] || []).map(value => ({ value })) };
  h.handlers.submit({ target: review, preventDefault() {} });
  assert.deepEqual(h.posted[2], { type: 'refine', viewId: 'view-1', draftId: 'draft-1', selection });
  selected.excerptReferenceIds = ['1', '2', '3', '4', '5'];
  h.handlers.submit({ target: review, preventDefault() {} });
  assert.equal(h.posted.length, 3);
  assert.match(h.status.textContent, /16 source references, 5 relationships and 4 excerpts/);
  assert.equal(h.status.dataset.status, 'error');
});

test('handoff renders one expandable capability notice and keeps busy list distinct from empty results', () => {
  const html = renderHandoffBody({ ...state, capability: { enabled: true, notice: 'Explicit local single-user preparation only.' } });
  assert.match(html, /<details[^>]*><summary>Local preparation and privacy<\/summary>/);
  assert.equal((html.match(/Explicit local single-user preparation only\./g) || []).length, 1);
  assert.doesNotMatch(renderHandoffBody({ ...state, status: 'loading' }), /No saved handoffs to show/);
});

test('panel refresh preserves the focused action or moves focus to the new main content', () => {
  for (const script of ['handoffs', 'checkpoints', 'mentor']) {
    const handlers = {}, calls = [];
    const active = { id: '', name: '', value: '', dataset: { action: 'refresh', view: 'old' } };
    const replacement = { id: '', name: '', value: '', dataset: { action: 'refresh', view: 'new' }, disabled: false, focus: options => calls.push(['action', options]) };
    const main = { focus: options => calls.push(['main', options]) };
    let candidates = [replacement];
    const root = { dataset: {}, contains: element => element === active, querySelectorAll: () => candidates, querySelector: () => main };
    const document = { activeElement: active, documentElement: { dataset: {} }, getElementById: () => root, addEventListener() {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../media/' + script + '.js'), 'utf8'), { acquireVsCodeApi: () => ({ postMessage() {} }), document, window: { addEventListener: (type, handler) => { handlers[type] = handler; } } });
    handlers.message({ data: { type: 'render', body: '<main></main>' } });
    assert.equal(calls[0][0], 'action', script);
    candidates = [];
    handlers.message({ data: { type: 'render', body: '<main></main>' } });
    assert.equal(calls[1][0], 'main', script);
    document.activeElement = undefined;
    handlers.message({ data: { type: 'render', body: '<main></main>' } });
    assert.equal(calls.length, 2, script + ' must not steal focus on first render');
  }
});

test('draft status changes disable submission during revalidation without replacing authored fields', () => {
  for (const script of ['handoffs', 'checkpoints']) {
    const handlers = {}, status = { dataset: {} }, submit = { disabled: false };
    const document = { getElementById: () => status, querySelector: () => submit, addEventListener() {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../media/' + script + '.js'), 'utf8'), { acquireVsCodeApi: () => ({ postMessage() {} }), document, window: { addEventListener: (type, handler) => { handlers[type] = handler; } } });
    handlers.message({ data: { type: 'status', status: 'error', message: 'Reconnect to continue', unavailable: true } });
    assert.equal(submit.disabled, true, script);
    handlers.message({ data: { type: 'status', status: 'loading', message: 'Checking…', unavailable: false } });
    assert.equal(submit.disabled, true, script);
    handlers.message({ data: { type: 'status', status: 'ready', message: 'Ready', unavailable: false } });
    assert.equal(submit.disabled, false, script);
  }
});
