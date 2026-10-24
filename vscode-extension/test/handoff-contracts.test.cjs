const test = require('node:test'); const assert = require('node:assert/strict');
const c = require('../.test-output/library.cjs');
const binding = { repositoryIdentity: 'https://github.com/a/b', indexedCommit: 'a'.repeat(40), snapshotId: 'snap' };
const input = { snapshotId: 'snap', sourceReferenceIds: ['ref'], question: ' exact? ', attemptedSteps: '', additionalContext: ' context\n', origin: { type: 'editor' } };
const selection = { referenceIds: ['ref'], relationshipIds: [], excerptReferenceIds: [], includeDocumentation: false, includeCheckpointNotes: false };
function preview() { const references = [{ id: 'ref', snapshotId: 'snap', file: 'src/a.ts', startLine: 1, endLine: 2, url: `${binding.repositoryIdentity}/blob/${binding.indexedCommit}/src/a.ts#L1-L2` }]; return { input, selection, candidates: { references, components: [], relationships: [], documentation: [], checkpointNotesAvailable: false }, context: { schemaVersion: 1, ...binding, question: input.question, attemptedSteps: '', additionalContext: input.additionalContext, origin: input.origin, references, components: [], relationships: [], documentation: [], excerpts: [], limitations: [], warnings: [] }, markdown: '# Exact package\n', digest: 'a'.repeat(64) }; }
test('handoff contracts preserve authored input and reject unknown fields, unsafe origins and limits', () => {
 assert.equal(typeof c.validateHandoffInput, 'function'); assert.deepEqual(c.validateHandoffInput(input, binding), input);
 for(const bad of [{...input, extra:'private'}, {...input, snapshotId:'other'}, {...input,question:' '}, {...input,question:'x'.repeat(1501)}, {...input,origin:{type:'checkpoint'}}, {...input,origin:{type:'pr',comparisonId:'../bad',comparisonSide:'before'}}, {...input,sourceReferenceIds:['ref','ref']}]) assert.throws(()=>c.validateHandoffInput(bad,binding));
});
test('handoff preview validates every candidate citation, selection and exact authored text', () => {
 assert.equal(typeof c.validateHandoffPreview,'function'); assert.deepEqual(c.validateHandoffPreview(preview(),binding,input,selection),preview());
 for(const mutate of [p=>p.input.question='changed', p=>p.context.question='changed',p=>p.context.indexedCommit='b'.repeat(40),p=>p.candidates.references[0].url='https://evil.test',p=>p.selection.referenceIds=['unknown'],p=>p.context.excerpts=[{referenceId:'ref',text:'secret',startLine:1,endLine:1}],p=>p.context.checkpointNotes={discovery:'secret',unresolved:'',nextStep:''}]) { const p=structuredClone(preview());mutate(p); assert.throws(()=>c.validateHandoffPreview(p,binding,input,selection)); }
});
test('saved handoffs preserve approved package and allow historical same repository reads',()=>{
 const p=preview(); const saved={id:'123e4567-e89b-42d3-a456-426614174000',schemaVersion:1,status:'ready',createdAt:'2026-10-24T00:00:00Z',updatedAt:'2026-10-24T00:00:00Z',context:p.context,markdown:p.markdown,digest:p.digest};
 assert.equal(typeof c.validateSavedHandoff,'function');assert.deepEqual(c.validateSavedHandoff(saved,binding,saved.id,p),saved);
 const historic={...binding,snapshotId:'new',indexedCommit:'b'.repeat(40)}; assert.deepEqual(c.validateSavedHandoff(saved,historic,saved.id),saved);
 for(const mutate of [s=>s.markdown+='changed',s=>s.digest='b'.repeat(64),s=>s.context.additionalContext='changed']) { const s=structuredClone(saved);mutate(s);assert.throws(()=>c.validateSavedHandoff(s,binding,saved.id,p)); }
});
module.exports={binding,input,selection,preview};

test('handoff redaction permits omitted component and unavailable approved excerpts with warning',()=>{
 const p=preview();p.input={...input,componentId:'component'};p.candidates.components=[{id:'component',name:'A',role:'module',referenceId:'ref'}];p.selection={...selection,referenceIds:[]};p.context.references=[];
 assert.equal(c.validateHandoffPreview(p,binding,p.input,p.selection).context.component,undefined);
 const x=preview();x.selection={...selection,excerptReferenceIds:['ref']};x.context.warnings=['Approved excerpt is unavailable'];assert.equal(c.validateHandoffPreview(x,binding,input,x.selection).context.excerpts.length,0);
});
test('handoff binding rejects unsafe component identifiers and PR comparison IDs',()=>{
 for(const change of [{componentId:'../bad'}, {origin:{type:'pr',comparisonId:'not-a-record',comparisonSide:'before'}}])assert.throws(()=>c.validateHandoffInput({...input,...change},binding));
});
test('handoff selected excerpts remain inside pinned ranges and line limits',()=>{
 const p=preview();p.selection={...selection,excerptReferenceIds:['ref']};p.context.excerpts=[{referenceId:'ref',text:'line1\nline2',startLine:1,endLine:2}];assert.equal(c.validateHandoffPreview(p,binding,input,p.selection).context.excerpts.length,1);
 for(const mutate of [p=>p.context.excerpts[0].startLine=0,p=>p.context.excerpts[0].endLine=3,p=>p.context.excerpts[0].text='x'.repeat(3001)]){const x=structuredClone(p);mutate(x);assert.throws(()=>c.validateHandoffPreview(x,binding,input,x.selection));}
});

test('handoff default preview never opts into private notes documentation or excerpts',()=>{
 const p=preview();p.selection={...selection,excerptReferenceIds:['ref']};p.context.excerpts=[{referenceId:'ref',text:'source',startLine:1,endLine:1}];assert.throws(()=>c.validateHandoffPreview(p,binding,input));
});
test('handoff pages reject private detail leakage and export requires exact identity',()=>{
 const id='123e4567-e89b-42d3-a456-426614174000';const summary={id,question:'Question',snapshotId:'old',indexedCommit:'b'.repeat(40),createdAt:'2026-10-24T00:00:00Z',status:'ready'};const page={repositoryIdentity:binding.repositoryIdentity,items:[summary],limit:10,offset:0,hasMore:false};assert.deepEqual(c.validateHandoffPage(page,binding,10,0),page);assert.throws(()=>c.validateHandoffPage({...page,items:[{...summary,markdown:'private'}]},binding,10,0));assert.throws(()=>c.validateHandoffPage({...page,repositoryIdentity:'https://github.com/other/repo'},binding,10,0));assert.throws(()=>c.validateHandoffExport({id,markdown:'x',digest:'a'.repeat(64)},'other'));
});
