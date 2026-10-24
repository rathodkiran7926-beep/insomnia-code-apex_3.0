const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { activate, editor } = require('../.test-output/activation.cjs');
const manifest = require('../package.json');

const pause = () => new Promise(resolve => setTimeout(resolve, 95));
test('Focus webview displays backend states; commands register; all resources dispose', { timeout: 10000 }, async t => {
  const state = editor.testState;
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  state.setBaseUrl(base);
  assert.equal(manifest.contributes.views.codebaseMentor.find(v => v.id === 'codebaseMentor.focus').type, 'webview');
  const context = { subscriptions: [], extensionUri: editor.Uri.parse('file:///extension') };
  activate(context);
  const focus = state.providers.get('codebaseMentor.focus');
  assert.ok(focus);
  const webview = state.webviews.get('codebaseMentor.focus');
  assert.ok(webview);
  assert.match(webview.view.webview.html, /connect-src 'none'/);
  await pause();
  assert.equal(webview.messages.at(-1).model.folderCount, 0);
  for (const view of manifest.contributes.views.codebaseMentor) assert.ok(state.providers.has(view.id));
  for (const command of manifest.contributes.commands) assert.ok(state.handlers.has(command.command), command.command);
  await state.handlers.get('codebaseMentor.checkConnection')(); await pause();
  assert.equal(webview.messages.at(-1).model.connection.status, 'connected');
  const beforeCursorChanges = requests;
  for (let index = 0; index < 20; index++) state.selections.fire({});
  await pause();
  assert.equal(requests, beforeCursorChanges, 'Cursor events must not make backend requests');
  await state.handlers.get('codebaseMentor.openWorkspace')();
  await state.handlers.get('codebaseMentor.openSettings')();
  assert.deepEqual(state.calls.slice(-3), [
    ['workbench.view.extension.codebaseMentor'], ['codebaseMentor.focus.focus'],
    ['workbench.action.openSettings', '@ext:codebase-mentor-local.codebase-mentor'],
  ]);
  state.setBaseUrl('invalid');
  state.configuration.fire({ affectsConfiguration: key => key === 'codebaseMentor.apiBaseUrl' });
  await pause(); await pause();
  assert.equal(webview.messages.at(-1).model.connection.status, 'invalid-configuration');
  state.setBaseUrl(base); await state.handlers.get('codebaseMentor.checkConnection')(); await pause();
  assert.equal(webview.messages.at(-1).model.connection.status, 'connected');
  const old = state.calls.length;
  webview.receive({ type: 'action', epoch: webview.messages.at(-1).epoch, action: 'settings' });
  await pause();
  assert.equal(state.calls.at(-1)[0], 'codebaseMentor.openSettings');
  webview.receive({ type: 'action', epoch: -1, action: 'disconnect' });
  webview.receive({ type: 'action', epoch: webview.messages.at(-1).epoch, action: 'unrecognized-command' });
  await pause();
  assert.equal(state.calls.length, old + 1, 'Stale/unknown UI actions must be ignored');
  for (const disposable of context.subscriptions) disposable.dispose();
  assert.equal(state.handlers.size, 0); assert.equal(state.providers.size, 0);
  assert.equal(state.configuration.listeners.size, 0); assert.equal(state.folders.listeners.size, 0);
  assert.equal(state.selections.listeners.size, 0);
});
