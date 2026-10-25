const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {registerMoveToIde,parseIdeSourceUri,SourceNavigation,editor}=require('../.test-output/activation.cjs');
const commit='a'.repeat(40),repository='https://github.com/a/b';
const link=(changes={})=>'vscode://codebase-mentor-local.codebase-mentor/open-source?'+new URLSearchParams({repository,commit,file:'src/a.ts',line:'3',...changes});
async function setup(t){
  const root=await fs.mkdtemp(path.resolve('.test-output/move-ide-'));await fs.mkdir(path.join(root,'src'));await fs.writeFile(path.join(root,'src/a.ts'),'one\ntwo\nthree\n');
  const workspaceUri=pathToFileURL(root).href,fileUri=pathToFileURL(path.join(root,'src/a.ts')).href;
  const binding={version:1,workspaceUri,backendUrl:'http://127.0.0.1:3001/',snapshotId:'snap',repositoryIdentity:repository,indexedCommit:commit,connectedAt:'now'};
  const reference={id:'ref',snapshotId:'snap',file:'src/a.ts',startLine:1,endLine:2,url:`${repository}/blob/${commit}/src/a.ts#L1-L2`};
  const evidence={...binding,limitations:[],components:[],references:[reference]};
  const api={backendIdentity:binding.backendUrl,evidence:async()=>evidence,source:async()=>({snapshotId:'snap',file:'src/a.ts',startLine:1,endLine:4,complete:true,excerpt:'one\ntwo\nthree\n',url:`${repository}/blob/${commit}/src/a.ts#L1`})};
  let current=binding,head=commit;
  const nav=new SourceNavigation(api,{read:()=>({rootUri:workspaceUri,identity:repository,head}),fileModified:()=>false},{bindingFor:()=>current});
  const context={subscriptions:[]};editor.workspace.isTrusted=true;
  registerMoveToIde(context,api,nav,()=>current?[current]:[]);
  const open=editor.testState.handlers.get('codebaseMentor.moveToIde');
  t.after(async()=>{for(const item of context.subscriptions)item.dispose();nav.dispose();editor.testState.documents.clear();editor.testState.shown.length=0;await fs.rm(root,{recursive:true,force:true});});
  return{open,api,fileUri,evidence,setHead:value=>{head=value},disconnect:()=>{current=undefined}};
}
test('Move to IDE URI reuses real local navigation and selects the exact absolute line in a regular tab',async t=>{
  const s=await setup(t);await s.open(link());
  const shown=editor.testState.shown.at(-1);assert.equal(shown.document.uri.toString(),s.fileUri);
  assert.equal(shown.selection.start.line,2);assert.equal(shown.selection.end.line,2);assert.equal(shown.selection.start.character,0);
  assert.equal(editor.testState.handlers.get('test:uri').handleUri instanceof Function,true);
  await editor.testState.handlers.get('test:uri').handleUri(editor.Uri.parse(link({line:'2'})));
  assert.equal(editor.testState.shown.at(-1).selection.start.line,1, 'Native URI handler opens the editor through the same verified navigation');
});
test('Move to IDE rejects disconnected, changed revision, missing files and mismatched snapshots without showing a guessed editor',async t=>{
  const s=await setup(t);
  for(const changes of [{repository:'https://github.com/other/repo'},{commit:'b'.repeat(40)},{file:'src/missing.ts'},{line:'999'}])await assert.rejects(s.open(link(changes)));
  s.setHead('b'.repeat(40));await assert.rejects(s.open(link()),/safely/);s.setHead(commit);
  s.evidence.indexedCommit='c'.repeat(40);await assert.rejects(s.open(link()),/version/);s.evidence.indexedCommit=commit;
  await fs.unlink(editor.Uri.parse(s.fileUri).fsPath);editor.testState.documents.clear();await assert.rejects(s.open(link()),/missing|safely/);
  s.disconnect();await assert.rejects(s.open(link()),/Connect/);
  assert.equal(editor.testState.shown.length,0);
});
test('Move to IDE never applies old coordinates to changed text or dirty buffers',async t=>{
  const s=await setup(t);await fs.writeFile(editor.Uri.parse(s.fileUri).fsPath,'changed\nfile\ntext\n');
  await assert.rejects(s.open(link()),/safely/);assert.equal(editor.testState.shown.length,0);
});
test('browser paths and duplicate/query parameters cannot invoke arbitrary commands',()=>{
  for(const changes of [{file:'../secret'},{file:'C:/secret'},{file:'src/%2e%2e/secret'},{file:'src/.git/config'},{line:'0'},{line:'-1'},{line:'1.5'},{commit:'main'}])assert.throws(()=>parseIdeSourceUri(editor.Uri.parse(link(changes))));
  for(const suffix of ['&line=4','&command=workbench.action.closeWindow'])assert.throws(()=>parseIdeSourceUri(editor.Uri.parse(link()+suffix)));
  assert.throws(()=>parseIdeSourceUri(editor.Uri.parse(link().replace('/open-source','/other'))));
});
