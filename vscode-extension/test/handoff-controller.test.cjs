const test = require('node:test'); const assert = require('node:assert/strict');
const { HandoffController } = require('../.test-output/library.cjs');
const binding = { version:1, workspaceUri:'file:///repo', backendUrl:'http://127.0.0.1:3001/',snapshotId:'snapshot',repositoryIdentity:'https://github.com/a/b',indexedCommit:'a'.repeat(40),connectedAt:'saved' };
const input = { snapshotId:'snapshot',componentId:'c0',sourceReferenceIds:['r0'],question:'User question?',attemptedSteps:'',additionalContext:'',origin:{type:'editor'} };
const selection = { referenceIds:['r0'],relationshipIds:[],excerptReferenceIds:[],includeDocumentation:false,includeCheckpointNotes:false };
const preview = { input,selection,context:{snapshotId:'snapshot'},markdown:'Exact reviewed Markdown',digest:'a'.repeat(64) };
const detail = { id:'task',context:preview.context,markdown:preview.markdown,digest:preview.digest };
function setup() { let current=binding,trusted=true; let saves=0; const api={backendIdentity:binding.backendUrl,handoffCapability:async()=>({enabled:true}),previewHandoff:async()=>preview,createHandoff:async()=>{saves++;return detail},listHandoffs:async()=>({items:[],limit:10,offset:0}),handoff:async()=>detail,exportHandoff:async()=>({id:detail.id,markdown:detail.markdown,digest:detail.digest}),deleteHandoff:async()=>({id:detail.id,deleted:true})}; const controller=new HandoffController(api,{binding:()=>current,trusted:()=>trusted}); return {controller,api,setBinding:b=>current=b,setTrusted:b=>trusted=b,saves:()=>saves}; }
test('opening composition checks capability without uploading authored drafts or saving',async()=>{const s=setup(); assert.equal(await s.controller.prepare(binding),true);assert.equal(s.saves(),0);assert.equal(s.controller.state.preview,undefined);s.controller.dispose()});
test('duplicate Save is serialized and saved Markdown must equal the reviewed preview',async()=>{const s=setup();await s.controller.prepare(binding);await s.controller.preview(binding,input);let finish;s.api.createHandoff=()=>{return new Promise(r=>finish=r)};const first=s.controller.save('request');await new Promise(r=>setImmediate(r));const second=s.controller.save('request');finish(detail);await Promise.all([first,second]);assert.equal(s.controller.state.detail.markdown,preview.markdown);s.controller.dispose()});
test('late preview after repository switch cannot leak original question into current context',async()=>{const s=setup();await s.controller.prepare(binding);let finish;s.api.previewHandoff=()=>new Promise(r=>finish=r);const request=s.controller.preview(binding,input);await new Promise(r=>setImmediate(r));s.setBinding({...binding,snapshotId:'other'});s.controller.contextChanged();finish(preview);await request;assert.equal(s.controller.state.preview,undefined);assert.equal(s.controller.state.detail,undefined);s.controller.dispose()});
test('disabled and untrusted contexts cannot preview or save',async()=>{const s=setup();s.api.handoffCapability=async()=>({enabled:false});assert.equal(await s.controller.prepare(binding),false);await s.controller.preview(binding,input);assert.equal(s.controller.state.preview,undefined);s.setTrusted(false);await s.controller.save('request');assert.equal(s.saves(),0);s.controller.dispose()});
test('private transport errors never echo authored notes and uncertain writes require deliberate retry',async()=>{const s=setup();await s.controller.prepare(binding);await s.controller.preview(binding,input);s.api.createHandoff=async()=>{throw new Error(input.question)};await s.controller.save('request');assert.doesNotMatch(s.controller.state.message,/User question/);assert.match(s.controller.state.message,/may have|uncertain|Refresh/);assert.ok(s.controller.state.preview);s.controller.dispose()});
test('export response must match saved reviewed content and does not itself write clipboard',async()=>{const s=setup();await s.controller.prepare(binding);await s.controller.open(detail.id);s.api.exportHandoff=async()=>({id:detail.id,markdown:'unapproved',digest:detail.digest});await assert.rejects(()=>s.controller.export(s.controller.state.viewId));s.controller.dispose()});
test('historical package exports through current same-repository scope when original snapshot is gone',async()=>{
 const s=setup();await s.controller.prepare(binding);s.api.handoff=async()=>({...detail,context:{snapshotId:'removed-original',repositoryIdentity:binding.repositoryIdentity,indexedCommit:binding.indexedCommit}});await s.controller.open(detail.id);
 let scoped;s.api.exportHandoff=async b=>{scoped=b;return {id:detail.id,markdown:detail.markdown,digest:detail.digest}};
 await s.controller.export(s.controller.state.viewId);assert.equal(scoped.snapshotId,binding.snapshotId);assert.equal(s.controller.state.contextBinding.snapshotId,'removed-original');s.controller.dispose();
});
test('failed review rebuild invalidates the old approval even after list Refresh',async()=>{const s=setup();await s.controller.prepare(binding);await s.controller.preview(binding,input);s.api.previewHandoff=async()=>{throw new Error('Private authored failure')};await s.controller.preview(binding,{...input,question:'Changed question'});assert.equal(s.controller.state.preview,undefined);await s.controller.refresh();await s.controller.save('request');assert.equal(s.saves(),0);s.controller.dispose()});
test('fork handoff exports and deletes through its validated fork scope rather than the base anchor',async()=>{const s=setup();const fork={...binding,snapshotId:'fork',repositoryIdentity:'https://github.com/fork/b',connectedAt:'comparison:1:after'};await s.controller.prepare(fork);s.api.previewHandoff=async()=>({...preview,input:{...input,snapshotId:'fork'},context:{snapshotId:'fork',repositoryIdentity:fork.repositoryIdentity,indexedCommit:fork.indexedCommit}});await s.controller.preview(fork,{...input,snapshotId:'fork'});const prepared=s.controller.state.preview;s.api.createHandoff=async()=>({...detail,context:prepared.context});await s.controller.save('request');let scope;s.api.exportHandoff=async b=>{scope=b;return{id:detail.id,markdown:detail.markdown,digest:detail.digest}};await s.controller.export(s.controller.state.viewId);assert.equal(scope.repositoryIdentity,fork.repositoryIdentity);s.api.deleteHandoff=async b=>{scope=b;return{id:detail.id,deleted:true}};await s.controller.delete(detail.id,s.controller.state.viewId);assert.equal(scope.snapshotId,'fork');s.controller.dispose()});

test('temporary binding revalidation retains handoff approval but blocks transmission until ready', async () => {
 let current = binding, recoverable = binding, trusted = true, saves = 0;
 const api = { backendIdentity: binding.backendUrl, handoffCapability: async () => ({enabled:true}), previewHandoff: async () => preview, createHandoff: async () => { saves++; return detail; }, listHandoffs: async () => ({items:[],limit:10,offset:0}) };
 const controller = new HandoffController(api, {binding:()=>current, recoverableBinding:()=>recoverable, trusted:()=>trusted});
 await controller.prepare(binding); await controller.preview(binding,input); const token=controller.state.viewId;
 current=undefined; controller.contextChanged();
 assert.equal(controller.state.binding,binding); assert.equal(controller.state.preview,preview); assert.equal(controller.state.status,'error');
 await controller.preview(binding,input); await controller.save('request'); assert.equal(saves,0);
 current=binding; controller.contextChanged(); assert.equal(controller.state.status,'ready'); assert.equal(controller.state.viewId,token);
 await controller.save('request'); assert.equal(saves,1); assert.equal(controller.state.detail,detail);
 await controller.prepare(binding); api.previewHandoff=async()=>{throw new Error('Preview failed')}; await controller.preview(binding,input);
 current=undefined; controller.contextChanged(); current=binding; controller.contextChanged();
 assert.equal(controller.state.status,'error'); assert.equal(controller.state.preview,undefined);
 await controller.save('different-request'); assert.equal(saves,1,'Recovery must not restore failed preview approval');
 current=undefined; trusted=false; controller.contextChanged();
 assert.equal(controller.state.binding,undefined); assert.equal(controller.state.detail,undefined); controller.dispose();
});

test('invalid backend configuration clears handoff context without a lifecycle exception', async () => {
 const s=setup(); await s.controller.prepare(binding); await s.controller.preview(binding,input);
 Object.defineProperty(s.api,'backendIdentity',{get(){throw new Error('Invalid backend URL')}});
 assert.doesNotThrow(()=>s.controller.contextChanged());
 assert.equal(s.controller.state.binding,undefined); assert.equal(s.controller.state.preview,undefined);
 s.controller.dispose();
});
