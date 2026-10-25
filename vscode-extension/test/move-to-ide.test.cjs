const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {registerMoveToIde,parseIdeSourceUri,SourceNavigation,editor}=require('../.test-output/activation.cjs');
const commit='a'.repeat(40),repository='https://github.com/a/b';
const link=(changes={})=>'vscode://codebase-mentor-local.codebase-mentor/moveToSource?'+new URLSearchParams({snapshotId:'snap',repository,commit,file:'src/a.ts',line:'3',...changes});
async function setup(t, connectResult){
  const root=await fs.mkdtemp(path.resolve('.test-output/move-ide-'));await fs.mkdir(path.join(root,'src'));await fs.writeFile(path.join(root,'src/a.ts'),'one\ntwo\nthree\n');
  const workspaceUri=pathToFileURL(root).href,fileUri=pathToFileURL(path.join(root,'src/a.ts')).href;
  const binding={version:1,workspaceUri,backendUrl:'http://127.0.0.1:3001/',snapshotId:'snap',repositoryIdentity:repository,indexedCommit:commit,connectedAt:'now'};
  const reference={id:'ref',snapshotId:'snap',file:'src/a.ts',startLine:1,endLine:2,url:`${repository}/blob/${commit}/src/a.ts#L1-L2`};
  const evidence={...binding,limitations:[],components:[],references:[reference]};
  const api={backendIdentity:binding.backendUrl,evidence:async()=>evidence,source:async()=>({snapshotId:'snap',file:'src/a.ts',startLine:1,endLine:4,complete:true,excerpt:'one\ntwo\nthree\n',url:`${repository}/blob/${commit}/src/a.ts#L1`})};
  let current=binding,head=commit, extra=[];
  const nav=new SourceNavigation(api,{read:()=>({rootUri:workspaceUri,identity:repository,head}),fileModified:()=>false},{bindingFor:()=>current});
  const context={subscriptions:[editor.workspace.registerTextDocumentContentProvider('codebase-mentor-source',nav)]};editor.workspace.isTrusted=true;
  registerMoveToIde(context,api,nav,()=>current?[current,...extra]:[],undefined,connectResult === undefined ? undefined : async(target,isCurrent)=>{assert.equal(target.snapshotId,'snap');assert(isCurrent());if(connectResult){current=binding;return true}return false;});
  const open=editor.testState.handlers.get('codebaseMentor.moveToIde');
  t.after(async()=>{for(const item of context.subscriptions)item.dispose();nav.dispose();editor.testState.documents.clear();editor.testState.shown.length=0;await fs.rm(root,{recursive:true,force:true});});
  return{open,api,fileUri,evidence,multiple:()=>{extra=[{...binding,workspaceUri:workspaceUri+'/other'}]},setHead:value=>{head=value},disconnect:()=>{current=undefined}};
}
test('Move to IDE URI reuses real local navigation and selects the exact absolute line in a regular tab',async t=>{
  const s=await setup(t);await s.open(link());
  const shown=editor.testState.shown.at(-1);assert.equal(shown.document.uri.toString(),s.fileUri);
  assert.equal(shown.selection.start.line,2);assert.equal(shown.selection.end.line,2);assert.equal(shown.selection.start.character,0);
  assert.equal(editor.testState.handlers.get('test:uri').handleUri instanceof Function,true);
  await editor.testState.handlers.get('test:uri').handleUri(editor.Uri.parse(link({line:'2'})));
  assert.equal(editor.testState.shown.at(-1).selection.start.line,1, 'Native URI handler opens the editor through the same verified navigation');
});
test('Move to IDE rejects mismatches and uses indexed evidence for changed revisions or missing local files',async t=>{
  const s=await setup(t);
  for(const changes of [{repository:'https://github.com/other/repo'},{commit:'b'.repeat(40)},{file:'src/missing.ts'},{line:'999'}])await assert.rejects(s.open(link(changes)));
  s.setHead('b'.repeat(40));await s.open(link());assert.equal(editor.testState.shown.at(-1).document.uri.scheme,'codebase-mentor-source');s.setHead(commit);
  s.evidence.indexedCommit='c'.repeat(40);await assert.rejects(s.open(link()),/snapshot|commit/);s.evidence.indexedCommit=commit;
  await fs.unlink(editor.Uri.parse(s.fileUri).fsPath);editor.testState.documents.clear();await s.open(link());assert.equal(editor.testState.shown.at(-1).document.uri.scheme,'codebase-mentor-source');
  s.disconnect();await assert.rejects(s.open(link()),/connect/i);
  assert(editor.testState.shown.every(item=>item.document.uri.scheme==='codebase-mentor-source'));
});
test('Move to IDE never applies old coordinates to changed text or dirty buffers',async t=>{
  const s=await setup(t);await fs.writeFile(editor.Uri.parse(s.fileUri).fsPath,'changed\nfile\ntext\n');
  await s.open(link());assert.equal(editor.testState.shown.at(-1).document.uri.scheme,'codebase-mentor-source');assert.equal(editor.testState.shown.at(-1).selection.start.line,2);
});
test('browser paths and duplicate/query parameters cannot invoke arbitrary commands',()=>{
  for(const changes of [{snapshotId:''},{snapshotId:'bad/target'},{file:'../secret'},{file:'C:/secret'},{file:'src/%2e%2e/secret'},{file:'src/.git/config'},{line:'0'},{line:'-1'},{line:'1.5'},{commit:'main'}])assert.throws(()=>parseIdeSourceUri(editor.Uri.parse(link(changes))));
  for(const suffix of ['&line=4','&command=workbench.action.closeWindow'])assert.throws(()=>parseIdeSourceUri(editor.Uri.parse(link()+suffix)));
  assert.throws(()=>parseIdeSourceUri(editor.Uri.parse(link().replace('/moveToSource','/other'))));
});


test('snapshot ID is mandatory even when repository and commit match',async t=>{
  const s=await setup(t);await assert.rejects(s.open(link({snapshotId:'other'})),/snapshot/);
  const url=new URL(link());url.searchParams.delete('snapshotId');assert.throws(()=>parseIdeSourceUri(editor.Uri.parse(url.href)));
  assert.throws(()=>parseIdeSourceUri(editor.Uri.parse(link()+'&file='+ 'x'.repeat(5000))));
  assert.equal(editor.testState.shown.length,0);
});
test('untrusted workspaces, unavailable snapshots and sources fail without guessing',async t=>{
  const s=await setup(t);editor.workspace.isTrusted=false;
  try{await assert.rejects(s.open(link()),/Trust/);}finally{editor.workspace.isTrusted=true;}
  const evidence=s.api.evidence;s.api.evidence=async()=>{throw Error('Snapshot unavailable')};await assert.rejects(s.open(link()),/unavailable/);s.api.evidence=evidence;
  s.api.source=async()=>{throw Error('Indexed source unavailable')};await assert.rejects(s.open(link()),/unavailable/);
  assert.equal(editor.testState.shown.length,0);
});
test('multiple matching workspaces require selection and cancellation opens nothing',async t=>{
  const s=await setup(t);s.multiple();const original=editor.window.showQuickPick;let asked=0;
  try{
    editor.window.showQuickPick=async candidates=>{asked++;assert.equal(candidates.length,2);return undefined;};
    await s.open(link());assert.equal(asked,1);assert.equal(editor.testState.shown.length,0);
    editor.window.showQuickPick=async candidates=>candidates[0];await s.open(link());assert.equal(editor.testState.shown.at(-1).document.uri.toString(),s.fileUri);
  }finally{editor.window.showQuickPick=original;}
});
test('a dirty editor uses a labeled immutable source document and pins the requested line',async t=>{
  const s=await setup(t);const local=await editor.workspace.openTextDocument(editor.Uri.parse(s.fileUri));local.isDirty=true;
  await s.open(link());const shown=editor.testState.shown.at(-1);
  assert.equal(shown.document.uri.scheme,'codebase-mentor-source');assert(shown.document.uri.path.includes(commit.slice(0,12)));
  assert.equal(shown.selection.start.line,2);assert.equal(shown.selection.end.line,2);
});

test('Move to IDE connects a verified target and resumes the original line without another input',async t=>{
 const s=await setup(t,true);s.disconnect();await s.open(link());assert.equal(editor.testState.shown.at(-1).document.uri.toString(),s.fileUri);assert.equal(editor.testState.shown.at(-1).selection.start.line,2);
});
test('canceling snapshot connection opens no editor',async t=>{
 const s=await setup(t,false);s.disconnect();await s.open(link());assert.equal(editor.testState.shown.length,0);
});
