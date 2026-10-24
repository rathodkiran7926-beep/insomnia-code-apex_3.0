const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { activate, editor } = require('../.test-output/activation.cjs');
const manifest = require('../package.json');

test('activated providers render actual health and configuration failures; all resources dispose', { timeout: 10000 }, async t => {
  const state = editor.testState;
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  state.setBaseUrl(base);
  const context = { subscriptions: [] };
  activate(context);
  const focus = state.providers.get('codebaseMentor.focus');
  assert.ok(focus);
  assert.ok(focus.getChildren().some(item => item.label === 'Connecting'));
  assert.ok(focus.getChildren().some(item => item.label === 'No workspace open'));
  for (const view of manifest.contributes.views.codebaseMentor) assert.ok(state.providers.has(view.id));
  for (const command of manifest.contributes.commands) assert.ok(state.handlers.has(command.command));
  await state.handlers.get('codebaseMentor.checkConnection')();
  assert.ok(focus.getChildren().some(item => item.label === 'Connected'));
  const beforeCursorChanges = requests;
  for (let index = 0; index < 20; index++) state.selections.fire({});
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(requests, beforeCursorChanges, 'Cursor events must not make backend requests');
  await state.handlers.get('codebaseMentor.openWorkspace')();
  await state.handlers.get('codebaseMentor.openSettings')();
  assert.deepEqual(state.calls, [
    ['workbench.view.extension.codebaseMentor'], ['codebaseMentor.focus.focus'],
    ['workbench.action.openSettings', '@ext:codebase-mentor-local.codebase-mentor'],
  ]);
  state.setBaseUrl('invalid');
  const changed = new Promise(resolve => {
    const listener = focus.onDidChangeTreeData(() => {
      if (focus.getChildren().some(item => item.label === 'Invalid backend configuration')) {
        listener.dispose(); resolve();
      }
    });
  });
  state.configuration.fire({ affectsConfiguration: key => key === 'codebaseMentor.apiBaseUrl' });
  await changed;
  state.setBaseUrl(base); await state.handlers.get('codebaseMentor.checkConnection')();
  assert.ok(focus.getChildren().some(item => item.label === 'Connected'));
  assert.deepEqual(state.errors, []);
  for (const disposable of context.subscriptions) disposable.dispose();
  assert.equal(state.handlers.size, 0); assert.equal(state.providers.size, 0);
  assert.equal(state.configuration.listeners.size, 0); assert.equal(state.folders.listeners.size, 0);
  assert.equal(state.selections.listeners.size, 0);
});
