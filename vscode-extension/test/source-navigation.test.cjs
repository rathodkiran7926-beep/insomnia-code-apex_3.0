const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { SourceNavigation, editor } = require('../.test-output/activation.cjs');
const sha = 'a'.repeat(40);
async function setup(t) {
  const root = await fs.mkdtemp(path.resolve('.test-output/navigation-'));
  await fs.mkdir(path.join(root, 'src')); await fs.writeFile(path.join(root, 'src/a.ts'), 'one\ntwo\nthree\n');
  const workspaceUri = pathToFileURL(root).href;
  const fileUri = pathToFileURL(path.join(root, 'src/a.ts')).href;
  const binding = { version: 1, workspaceUri, backendUrl: 'http://127.0.0.1:3001/', snapshotId: 'snap', repositoryIdentity: 'https://github.com/a/b', indexedCommit: sha };
  const reference = { id: 'ref0', snapshotId: 'snap', file: 'src/a.ts', startLine: 2, endLine: 3, url: `https://github.com/a/b/blob/${sha}/src/a.ts#L2-L3` };
  const result = { id: 'answer-1', binding, snapshot: { ...binding, limitations: [] }, component: { id: 'c0', name: 'first', role: 'function', referenceId: 'ref0' }, sourceContext: { workspaceUri, repositoryRootUri: workspaceUri, documentUri: fileUri, file: 'src/a.ts', binding }, answer: { citations: [reference] } };
  let local = { rootUri: workspaceUri, identity: binding.repositoryIdentity, head: sha }; let modified = false; let fail = false; let currentBinding = binding;
  const source = { snapshotId: 'snap', file: 'src/a.ts', excerpt: 'one\ntwo\nthree\n', complete: true, startLine: 1, endLine: 4, url: `https://github.com/a/b/blob/${sha}/src/a.ts#L1` };
  const api = { backendIdentity: binding.backendUrl, source: async () => { if (fail) throw new Error('Source unavailable'); return source; } };
  const git = { read: () => local, fileModified: () => modified };
  const nav = new SourceNavigation(api, git, { bindingFor: () => currentBinding });
  editor.workspace.workspaceFolders = [{ uri: editor.Uri.parse(workspaceUri), name: 'repo', index: 0 }];
  editor.workspace.isTrusted = true;
  const registration = editor.workspace.registerTextDocumentContentProvider('codebase-mentor-source', nav);
  t.after(async () => { registration.dispose(); nav.dispose(); editor.testState.documents.clear(); editor.testState.shown.length = 0; editor.workspace.workspaceFolders = undefined; await fs.rm(root, { recursive: true, force: true }); });
  return { nav, result, reference, fileUri, api, source, setLocal: value => { local = value; }, setModified: value => { modified = value; }, setFail: () => { fail = true; }, setBinding: value => { currentBinding = value; } };
}
test('verified local source opens the real file and converts exact cited lines to 0-based ranges', async t => {
  const s = await setup(t); assert.equal(await s.nav.open(s.result, 'ref0'), 'local');
  const shown = editor.testState.shown.at(-1);
  assert.equal(shown.document.uri.toString(), s.fileUri);
  assert.equal(shown.selection.start.line, 1); assert.equal(shown.selection.end.line, 2);
});

test('Atlas relationship evidence reuses exact navigation independently of Mentor citations', async t => {
  const s = await setup(t); const edgeRef = { ...s.reference, id: 'edge-real', startLine: 1, endLine: 1, url: `https://github.com/a/b/blob/${sha}/src/a.ts#L1-L1` };
  assert.equal(await s.nav.openReference(s.result, edgeRef), 'local');
  assert.equal(editor.testState.shown.at(-1).selection.start.line, 0);
  await assert.rejects(() => s.nav.openReference(s.result, { ...edgeRef, snapshotId: 'other' }));
});
test('native PR diff uses exact read-only source for both immutable sides, never current editor or patch text', async t => {
  const s = await setup(t); const otherSha = 'b'.repeat(40);
  const right = { ...s.result, binding: { ...s.result.binding, snapshotId: 'after', indexedCommit: otherSha, connectedAt: 'temporary-after' }, snapshot: { ...s.result.snapshot, snapshotId: 'after', indexedCommit: otherSha } };
  const rightRef = { ...s.reference, snapshotId: 'after', url: `https://github.com/a/b/blob/${otherSha}/src/a.ts#L2-L3` };
  const nav = new SourceNavigation({ ...s.api, source: async (snapshot) => ({ ...s.source, snapshotId: snapshot.snapshotId, excerpt: snapshot.snapshotId === 'after' ? 'new\nsecond\nthird\n' : s.source.excerpt, url: `https://github.com/a/b/blob/${snapshot.indexedCommit}/src/a.ts#L1` }) }, { read: () => ({}), fileModified: () => false }, { bindingFor: (_uri, expected) => expected });
  const registration = editor.workspace.registerTextDocumentContentProvider('codebase-mentor-source', nav);
  t.after(() => { registration.dispose(); nav.dispose(); });
  await nav.openDiff(s.result, s.reference, right, rightRef);
  const call = editor.testState.calls.at(-1); assert.equal(call[0], 'vscode.diff');
  assert.equal(call[1].scheme, 'codebase-mentor-source'); assert.equal(call[2].scheme, 'codebase-mentor-source');
  assert((await nav.provideTextDocumentContent(call[1])).includes('one')); assert((await nav.provideTextDocumentContent(call[2])).includes('new'));
  await assert.rejects(() => nav.openDiff(s.result, s.reference, right, { ...rightRef, snapshotId: 'wrong' }));
});
test('different HEAD, modified files and missing files use immutable read-only backend text', async t => {
  const s = await setup(t);
  s.setLocal({ identity: 'https://github.com/a/b', head: 'b'.repeat(40) });
  assert.equal(await s.nav.open(s.result, 'ref0'), 'indexed');
  assert.equal(editor.testState.shown.at(-1).document.uri.scheme, 'codebase-mentor-source');
  assert.ok(editor.testState.shown.at(-1).document.uri.path.includes(`indexed ${sha.slice(0, 12)}`));
  assert.equal(editor.testState.shown.at(-1).document.getText(), s.source.excerpt);
  s.setLocal({ rootUri: s.result.binding.workspaceUri, identity: 'https://github.com/a/b', head: sha }); s.setModified(true);
  assert.equal(await s.nav.open(s.result, 'ref0'), 'indexed');
  s.setModified(false); await fs.unlink(editor.Uri.parse(s.fileUri).fsPath);
  editor.testState.documents.clear(); assert.equal(await s.nav.open(s.result, 'ref0'), 'indexed');
});
test('HEAD equality cannot substitute for comparing actual file contents or dirty editor state', async t => {
  const s = await setup(t); await fs.writeFile(editor.Uri.parse(s.fileUri).fsPath, 'changed\nsource\ntext\n');
  assert.equal(await s.nav.open(s.result, 'ref0'), 'indexed');
  editor.testState.documents.clear(); await fs.writeFile(editor.Uri.parse(s.fileUri).fsPath, s.source.excerpt);
  const doc = await editor.workspace.openTextDocument(editor.Uri.parse(s.fileUri)); doc.isDirty = true;
  assert.equal(await s.nav.open(s.result, 'ref0'), 'indexed');
});
test('unsafe paths, wrong snapshots and stale backend bindings never open arbitrary sources', async t => {
  const s = await setup(t);
  for (const bad of [{ ...s.reference, file: '../secret' }, { ...s.reference, snapshotId: 'other' }, { ...s.reference, url: 'https://evil.com' }]) await assert.rejects(s.nav.open({ ...s.result, answer: { citations: [bad] } }, 'ref0'));
  s.api.backendIdentity = 'https://other.example/'; await assert.rejects(s.nav.open(s.result, 'ref0'));
  assert.equal(editor.testState.shown.length, 0);
});
test('unavailable indexed source offers only a validated immutable GitHub fallback', async t => {
  const s = await setup(t); s.setFail(); editor.window.showWarningMessage = async () => 'Open pinned GitHub source';
  assert.equal(await s.nav.open(s.result, 'ref0'), 'external');
  assert.equal(editor.testState.external.at(-1), s.reference.url);
  await assert.rejects(s.nav.provideTextDocumentContent(editor.Uri.parse('codebase-mentor-source:/unregistered.ts')));
});

test('repository switch while loading a local citation cannot reveal the obsolete editor', async t => {
  const s = await setup(t);
  const original = editor.workspace.openTextDocument;
  editor.workspace.openTextDocument = async uri => {
    const document = await original.call(editor.workspace, uri);
    if (uri.toString() === s.fileUri) {
      s.setBinding({ ...s.result.binding, snapshotId: 'different-snapshot' });
      s.nav.contextChanged();
    }
    return document;
  };
  t.after(() => { editor.workspace.openTextDocument = original; });
  await assert.rejects(() => s.nav.open(s.result, 'ref0'));
  assert.equal(editor.testState.shown.length, 0, 'Cancelled source must be checked before revealing an editor');
});

test('checkout change while loading a local citation opens only its immutable indexed source', async t => {
  const s = await setup(t);
  const original = editor.workspace.openTextDocument;
  editor.workspace.openTextDocument = async uri => {
    const document = await original.call(editor.workspace, uri);
    if (uri.toString() === s.fileUri) s.setLocal({ rootUri: s.result.binding.workspaceUri, identity: s.result.binding.repositoryIdentity, head: 'b'.repeat(40) });
    return document;
  };
  t.after(() => { editor.workspace.openTextDocument = original; });
  assert.equal(await s.nav.open(s.result, 'ref0'), 'indexed');
  assert.deepEqual(editor.testState.shown.map(item => item.document.uri.scheme), ['codebase-mentor-source']);
});

test('Atlas Open Source prefers the actual workspace editor without claiming historical lines when Git identity is unknown', async t => {
  const s = await setup(t);
  s.setLocal({});
  assert.equal(await s.nav.openWorkspaceSource(s.result, s.reference), 'local-unverified');
  const opened = editor.testState.shown.at(-1);
  assert.equal(opened.document.uri.toString(), s.fileUri);
  assert.equal(opened.selection, undefined, 'unverified local content must not receive stale citation coordinates');
});
test('Atlas Open Source highlights citation lines only when complete local content and commit are verified', async t => {
  const s = await setup(t);
  assert.equal(await s.nav.openWorkspaceSource(s.result, s.reference), 'local');
  const opened = editor.testState.shown.at(-1);
  assert.equal(opened.document.uri.toString(), s.fileUri);
  assert.equal(opened.selection.start.line, 1);
});
test('Atlas Open Source rejects unsafe references and uses indexed fallback when workspace file is absent', async t => {
  const s = await setup(t);
  await assert.rejects(() => s.nav.openWorkspaceSource(s.result, { ...s.reference, file: '../secret.ts' }));
  await fs.unlink(editor.Uri.parse(s.fileUri).fsPath);
  assert.equal(await s.nav.openWorkspaceSource(s.result, s.reference), 'indexed');
  assert.equal(editor.testState.shown.at(-1).document.uri.scheme, 'codebase-mentor-source');
});
test('Atlas Open Source refuses to reveal a file if the repository binding changes during async open', async t => {
  const s = await setup(t);
  s.setLocal({});
  const original = editor.workspace.openTextDocument;
  editor.workspace.openTextDocument = async uri => {
    const document = await original.call(editor.workspace, uri);
    if (uri.toString() === s.fileUri) s.setBinding({ ...s.result.binding, snapshotId: 'replaced' });
    return document;
  };
  t.after(() => { editor.workspace.openTextDocument = original; });
  await assert.rejects(() => s.nav.openWorkspaceSource(s.result, s.reference));
  assert.equal(editor.testState.shown.length, 0);
});
