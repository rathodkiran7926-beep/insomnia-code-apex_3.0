const {test} = require('node:test');
const assert = require('node:assert/strict');
const {focusModel, FocusView, editor} = require('../.test-output/activation.cjs');
const vscode = editor;
const binding = { workspaceUri: 'file:///repo', backendUrl: 'http://127.0.0.1:3001', snapshotId: 'snapshot-a', repositoryIdentity: 'https://github.com/owner/repo', indexedCommit: 'a'.repeat(40), connectedAt: 'stamp' };
const folder = { uri: 'file:///repo', name: 'repo' };
const task = { id: 'task-one', taskTitle: 'Investigate auth', createdAt: '2026-10-25T00:00:00Z' };
const handoff = { id: 'hand-one', question: 'How does auth work?', createdAt: '2026-10-25T00:00:00Z' };
const env = () => ({
 connection: () => ({ status:'connected', message:'Connected' }),
 repositories: {context: () => ({status:'ready', binding, local: {branch:'main',head:'a'.repeat(40),dirty:false}, comparison:{identity:'matched',revision:'matched'}}),bindingFor:() => binding},
 editor: () => ({workspaceUri:folder.uri,file:'src/auth.ts',selection:{start:{line:12},end:{line:12}},hasUnsavedChanges:false}),
 mentor:()=>({status:'idle'}), tasks:()=>({binding,status:'ready',message:'Ready',page:{items:[task],hasMore:false,offset:0}}),
 handoffs:()=>({binding,status:'ready',message:'Ready',page:{items:[handoff],hasMore:false,offset:0}}),
 folders:()=>[folder], trusted:()=>true,
});
test('Focus model projects existing backend-validated state without gathering source', () => {
 const m = focusModel(env());
 assert.equal(m.repository.name,'owner/repo');
 assert.equal(m.repository.snapshot,'snapshot-a');
 assert.equal(m.repository.revision,'matched');
 assert.equal(m.selection.name,'auth.ts');
 assert.equal(m.tasks.items[0].title,'Investigate auth');
 assert.equal(m.handoffs.items[0].title,'How does auth work?');
 assert.ok(!JSON.stringify(m).includes('sourceText'));
});
test('Focus never leaks another repository saved tasks or handoffs', () => {
 const config = env();
 config.tasks = () => ({binding:{...binding,snapshotId:'wrong'},status:'ready',message:'Ready',page:{items:[task]}});
 config.handoffs = () => ({binding:{...binding,workspaceUri:'file:///other'},status:'ready',message:'Ready',page:{items:[handoff]}});
 const m = focusModel(config);
 assert.equal(m.tasks.items.length,0); assert.equal(m.handoffs.items.length,0);
});
test('Focus webview rejects unknown, stale and unlisted saved-item actions', async () => {
 const config=env(); const focus=new FocusView(vscode.Uri.parse('file:///extension'),config);
 const registration=vscode.window.registerWebviewViewProvider('test.focus',focus);
 const webview=vscode.testState.webviews.get('test.focus');
 const first=webview.messages.at(-1);
 assert.equal(first.type,'render');
 assert.match(webview.view.webview.html,/connect-src 'none'/);
 const before=vscode.testState.calls.length;
 webview.receive({type:'action',epoch:first.epoch-1,action:'disconnect'});
 webview.receive({type:'action',epoch:first.epoch,action:'not-allowed'});
 webview.receive({type:'action',epoch:first.epoch,action:'resumeTask',id:'other-task'});
 await new Promise(r=>setTimeout(r,20));
 assert.equal(vscode.testState.calls.length,before);
 webview.receive({type:'action',epoch:first.epoch,action:'resumeTask',id:'task-one'});
 await new Promise(r=>setTimeout(r,20));
 assert.equal(vscode.testState.calls.at(-1)[0],'codebaseMentor.resumeTask');
 assert.equal(vscode.testState.calls.at(-1)[1].contextId,JSON.stringify([binding.backendUrl,binding.workspaceUri,binding.snapshotId,binding.connectedAt]));
 focus.dispose();registration.dispose();
});
