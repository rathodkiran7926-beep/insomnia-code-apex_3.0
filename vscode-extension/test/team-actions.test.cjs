const test = require('node:test');
const assert = require('node:assert/strict');
const { TeamController, editor } = require('../.test-output/activation.cjs');
const owner = '11111111-1111-4111-8111-111111111111', senior = '22222222-2222-4222-8222-222222222222', workspace = '33333333-3333-4333-8333-333333333333';
const ref = { id:'ref0',snapshotId:'snapshot-a',file:'src/auth.ts',startLine:2,endLine:6,url:'https://github.com/example/repo/blob/'+'a'.repeat(40)+'/src/auth.ts#L2-L6' };
const binding = { workspaceUri:'file:///repo',backendUrl:'http://127.0.0.1:3001/',repositoryIdentity:'https://github.com/example/repo',snapshotId:'snapshot-a',indexedCommit:'a'.repeat(40),connectedAt:'one' };
function fixture(t, approve = true) {
  const originals = { input:editor.window.showInputBox, pick:editor.window.showQuickPick, warning:editor.window.showWarningMessage, info:editor.window.showInformationMessage, config:editor.workspace.getConfiguration, clipboard:editor.env.clipboard };
  const requests=[],copied=[];const notes=['Verify email','How should token expiration work?','Verification is implemented.','Add expiration handling.'];let posted;
  editor.workspace.getConfiguration=()=>({get:()=> 'https://mentor.example.test/'});
  editor.window.showInputBox=async()=>notes.shift();
  editor.window.showQuickPick=async choices=>choices[0];
  editor.window.showWarningMessage=async(_title,options)=>{
    assert.match(options.detail,/src\/auth.ts:2-6/);assert.match(options.detail,/Unsaved buffers and uncommitted code are not uploaded/);
    assert(!requests.some(r=>r.path==='/api/handoffs'));
    return approve?'Generate Handoff Link':undefined;
  };
  editor.window.showInformationMessage=async()=> 'Copy Link';
  editor.env.clipboard={writeText:async value=>copied.push(value)};
  const client={account:{user:{id:owner,name:'Junior Developer'},workspaces:[{id:workspace,name:'Demo team',role:'developer'}]},request:async(path,body,method)=>{
    requests.push({path,body,method});
    if(path.includes('/members'))return{members:[{id:owner,name:'Junior',role:'developer'},{id:senior,name:'Senior',role:'reviewer'}]};
    if(path==='/api/handoffs') { posted=body; return {session:{id:body.requestId}}; }
    if(path.endsWith('/share'))return{path:`/#/handoffs/${posted.requestId}`};
    return{sessions:[{id:posted?.requestId,title:'Verify email',status:'OPEN',updated_at:'2026-10-25T10:00:00Z'}],total:1};
  }};
  let active=binding;
  const api={backendIdentity:binding.backendUrl,evidence:async()=>({references:[ref]})};
  const mentor={resolveContext:async()=>({binding,reference:ref})};
  const controller=new TeamController(client,api,mentor,()=>active,()=>({binding,hasUnsavedChanges:true,getText:()=>{throw Error('Never read editor text')}}),()=>{},()=>({branch:'feature/email',headCommit:'b'.repeat(40),gitStatus:'modified'}));
  t.after(()=>{controller.dispose();editor.window.showInputBox=originals.input;editor.window.showQuickPick=originals.pick;editor.window.showWarningMessage=originals.warning;editor.window.showInformationMessage=originals.info;editor.workspace.getConfiguration=originals.config;editor.env.clipboard=originals.clipboard});
  return{controller,requests,copied,api,change:()=>{active={...binding,snapshotId:'snapshot-b'}}};
}
test('Share Context previews pinned evidence, requires approval, creates a real web handoff, and copies the configured link',async t=>{
  const f=fixture(t);await f.controller.share();
  const posts=f.requests.filter(r=>r.path==='/api/handoffs');assert.equal(posts.length,1);
  assert.equal(posts[0].body.snapshotId,binding.snapshotId);assert.equal(posts[0].body.referenceId,'ref0');assert.equal(posts[0].body.assignedTo,senior);
  assert.match(posts[0].body.actualBehavior,/feature\/email/);
  assert(!('code' in posts[0].body));assert(!('source' in posts[0].body));
  assert.equal(f.copied[0],`https://mentor.example.test/#/handoffs/${posts[0].body.requestId}`);
  assert.equal(f.controller.view.items[0].status,'OPEN');
});
test('cancelled review never creates a handoff or copies a link',async t=>{
  const f=fixture(t,false);await f.controller.share();
  assert(!f.requests.some(r=>r.path==='/api/handoffs'));assert.equal(f.copied.length,0);
});
test('a repository change during context preparation blocks the share',async t=>{
  const f=fixture(t);f.api.evidence=async()=>{f.change();return{references:[ref]}};
  await assert.rejects(f.controller.share(),/repository changed/);
  assert(!f.requests.some(r=>r.path==='/api/handoffs'));assert.equal(f.copied.length,0);
});
