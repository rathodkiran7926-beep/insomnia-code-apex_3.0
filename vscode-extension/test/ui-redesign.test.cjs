const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MentorTree, AtlasTree, AtlasPanel, editor } = require('../.test-output/activation.cjs');
const vscode = editor;

test('Focus keeps actions while reducing root clutter and exposing advanced controls progressively', () => {
  const checkpoint = { status: 'disabled', message: 'Saved Tasks disabled by backend' };
  const handoff = { status: 'disabled', message: 'Handoffs disabled by backend' };
  const focus = new MentorTree('focus', () => ({ status: 'connected', message: 'Healthy backend' }), undefined, undefined,
    () => ({ result: undefined }), () => checkpoint, () => handoff);
  const rows = focus.getChildren();
  assert(rows.length <= 12, 'Root should not be an unbounded settings/action list');
  assert(rows.some(item => item.command?.command === 'codebaseMentor.openMap'));
  assert(rows.some(item => item.command?.command === 'codebaseMentor.openMentor'));
  assert(rows.some(item => item.command?.command === 'codebaseMentor.askSeniorWithContext'));
  const tasks = rows.find(item => item.id === 'codebaseMentor.savedTasks');
  assert(tasks); assert.equal(focus.getChildren(tasks)[0].label, 'Tasks off · enable on local backend');
  assert(focus.getChildren(rows.find(item => item.label === 'Repository Details & Settings')).some(item => item.command?.command === 'codebaseMentor.openSettings'));
  focus.dispose();
});

test('Architecture tab sends only validated graph JSON and rejects stale webview actions', async () => {
  const oldCreate = vscode.window.createWebviewPanel;
  let receive, dispose; const messages = [];
  vscode.window.createWebviewPanel = () => ({
    viewColumn: 1, reveal() {}, dispose() { dispose?.(); },
    onDidDispose(cb) { dispose = cb; return { dispose() {} }; },
    webview: {
      cspSource: 'vscode-resource:', asWebviewUri: uri => uri,
      onDidReceiveMessage(cb) { receive = cb; return { dispose() {} }; },
      async postMessage(msg) { messages.push(msg); return true; }
    },
  });
  try {
    const component = id => ({ id, name: id, role: 'module', referenceId: `ref-${id}` });
    const atlasResult = { id: 'map-a', neighborhood: {
      component: component('root'), components: [component('root'), component('other')],
      references: [{ id: 'ref-root', file: 'a.ts', startLine: 1, endLine: 2 }, { id: 'ref-other', file: 'b.ts', startLine: 1, endLine: 3 }],
      incoming: [], outgoing: [{id:'edge',source:'root',target:'other',type:'imports',referenceId:'ref-other'}],
      documentation: [], limitations: [], repositoryIdentity:'https://github.com/a/b', indexedCommit:'a'.repeat(40), truncated:false,limit:25,
    }, target: {scopeNotice:'Indexed-only'} };
    const state = {status:'ready',message:'Static analysis',result:atlasResult,canBack:false};
    const atlas = {state,onChange(){return{dispose(){}}},current(id){if(id!=='map-a')throw Error('Stale');return atlasResult}};
    const panel = new AtlasPanel(vscode.Uri.parse('file:///extension'), atlas);
    panel.show();
    assert.match(panel.panel.webview.html, /connect-src 'none'/);
    receive({type:'ready'});
    assert.equal(messages.at(-1).neighborhood.outgoing[0].type, 'imports');
    assert.equal(messages.at(-1).neighborhood.component.name, 'root');
    const baseline = editor.testState.calls.length;
    receive({type:'action',action:'source',viewId:'stale',componentId:'root',referenceId:'ref-root'});
    receive({type:'action',action:'source',viewId:'map-a',componentId:'root',referenceId:'unknown'});
    await new Promise(r => setTimeout(r, 10));
    assert.equal(editor.testState.calls.length,baseline);
    panel.dispose();
  } finally { vscode.window.createWebviewPanel = oldCreate; }
});
