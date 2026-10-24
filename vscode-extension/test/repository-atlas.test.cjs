const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { validateRepositoryGraph, MentorApi } = require('../.test-output/library.cjs');
const { RepositoryAtlasPanel, editor } = require('../.test-output/activation.cjs');
const sha = 'b'.repeat(40);
const snapshot = 'snap';
const ref = (id, file) => ({ id, snapshotId:snapshot,file,startLine:1,endLine:4,url:`https://github.com/org/repo/blob/${sha}/${file}#L1-L4` });
const component = (id, referenceId) => ({id,name:id,role:'module',referenceId});
const graph = () => ({snapshotId:snapshot,repository:'https://github.com/org/repo',commit:sha,
  components:[component('c0','r0'),component('c1','r1')],
  references:[ref('r0','src/a.ts'),ref('r1','src/b.ts'),ref('r2','src/a.ts')],
  relationships:[{id:'e0',source:'c0',target:'c1',referenceId:'r2',type:'imports',certainty:'static'}],
  documentation:{snapshotId:snapshot},report:{limitations:['Static relationships only']} });
const binding={version:1,workspaceUri:'file:///repo',backendUrl:'http://127.0.0.1:3033/',repositoryIdentity:'https://github.com/org/repo',indexedCommit:sha,snapshotId:snapshot,connectedAt:'now'};
test('whole-snapshot graph keeps ALL validated components and edges, rejects dangling or cross-snapshot evidence',()=>{
  const input=graph();const output=validateRepositoryGraph(input,snapshot);
  assert.equal(output.components.length,2);assert.equal(output.relationships.length,1);
  assert.equal(output.relationships[0].type,'imports');assert.equal(output.references.length,3);
  const edits=[g=>g.relationships[0].target='missing',g=>g.relationships[0].referenceId='wrong',g=>g.references[0].snapshotId='other',g=>g.relationships.push({...g.relationships[0]}),g=>g.relationships[0].certainty=123];
  for(const modify of edits){const g=graph();modify(g);assert.throws(()=>validateRepositoryGraph(g,snapshot));}
  assert.throws(()=>validateRepositoryGraph(graph(),'other'));
});
test('full graph API uses existing snapshot endpoint, not a second analyzer or external web site',async t=>{
  const urls=[];const server=createServer((req,res)=>{urls.push(req.url);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(graph()));});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok)); t.after(()=>{server.closeAllConnections();server.close();});
  const api=new MentorApi(()=>`http://127.0.0.1:${server.address().port}`);
  assert.equal((await api.repositoryGraph(snapshot)).relationships.length,1);
  assert.deepEqual(urls,['/api/snapshots/snap']);
});
test('repository Atlas opens an internal webview, rejects stale actions and uses the stored snapshot',async()=>{
  const vscode=editor;const original=vscode.window.createWebviewPanel;const events=[];const messages=[];let receive,disposed;
  vscode.window.createWebviewPanel=()=>({viewColumn:1,reveal(){},dispose(){disposed?.();},onDidDispose(fn){disposed=fn;return{dispose(){}};},webview:{cspSource:'vscode-resource:',asWebviewUri:uri=>uri,onDidReceiveMessage(fn){receive=fn;return{dispose(){}};},html:'',async postMessage(msg){messages.push(msg);return true;}}});
  const api={backendIdentity:binding.backendUrl,repositoryGraph:async()=>validateRepositoryGraph(graph(),snapshot)};
  const panel=new RepositoryAtlasPanel(vscode.Uri.parse('file:///extension'),api,{
    trusted:()=>true,bindings:()=>[binding],current:()=>binding,
    async focus(_b,c){events.push(['focus',c.id]);},async source(_b,c){events.push(['source',c.id]);},
  });
  try {
    await panel.show();assert.match(panel.panel.webview.html,/connect-src 'none'/);
    receive({type:'ready'});await new Promise(ok=>setImmediate(ok));
    const payload=messages.at(-1);assert.equal(payload.graph.relationships[0].type,'imports');
    assert.equal(payload.graph.components.length,2);
    receive({type:'action',action:'focus',componentId:'c0',token:payload.token-1});
    receive({type:'action',action:'source',componentId:'not-found',token:payload.token});
    receive({type:'action',action:'focus',componentId:'c1',token:payload.token});
    await new Promise(ok=>setTimeout(ok,15));assert.deepEqual(events,[['focus','c1']]);
  }finally{panel.dispose();vscode.window.createWebviewPanel=original;}
});
