const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderMentorBody } = require('../.test-output/library.cjs');
test('Map explanation names the indexed component file independently of original editor context', () => {
  const html = renderMentorBody({ status: 'ready', message: 'Ready', result: { id: 'x', component: { name: 'B', role: 'function' }, componentSource: { file: 'b.ts' }, sourceContext: { file: 'a.ts' }, snapshot: { snapshotId: 'snap', repositoryIdentity: 'https://github.com/a/b', indexedCommit: 'a'.repeat(40) }, scopeNotice: 'Map target', question: 'Explain', answer: { mode: 'facts', notice: 'Source facts', answer: 'B facts', citations: [] } } });
  assert(html.includes('b.ts')); assert(!html.includes('a.ts'));
});
test('Mentor UI renders wrapped plain text, provenance and citation actions without executable backend markup', () => {
  const state = { status: 'ready', message: 'Ready', canPrevious: true, canLatest: false, result: { id: 'answer-1', component: { name: '<script>alert(1)</script>', role: 'function' }, snapshot: { snapshotId: 'snap', repositoryIdentity: 'https://github.com/a/b', indexedCommit: 'a'.repeat(40) }, sourceContext: { file: 'src/a.ts' }, indexedOnly: true, question: 'Explain', scopeNotice: 'Indexed component', answer: { mode: 'facts', notice: 'Source facts only', answer: '<img src=x onerror=alert(1)>\nActual evidence.', citations: [{ id: 'ref0', file: 'src/a.ts', startLine: 2, endLine: 4 }] } } };
  const html = renderMentorBody(state);
  assert.ok(html.includes('Facts-only')); assert.ok(html.includes('src/a.ts:2–4'));
  assert.ok(html.includes('data-reference="ref0"')); assert.ok(html.includes('maxlength="1500"'));
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img '));
  assert.ok(html.includes('independent question')); assert.ok(html.includes('aria-live'));
  assert.ok(renderMentorBody({ ...state, result: { ...state.result, answer: { ...state.result.answer, mode: 'ai' } } }).includes('AI-assisted explanation · Review required'));
});
test('chat-style Mentor separates authored question and answer and never mixes repositories', () => {
  const anchor = { backendUrl:'http://127.0.0.1:3001/', workspaceUri:'file:///repo', snapshotId:'s1' };
  const create = (id, snapshotId, componentId, question) => ({ id, binding:anchor, component:{id:componentId,referenceId:'r1',name:'function',role:'function'},componentSource:{file:'src/f.ts'},snapshot:{snapshotId,repositoryIdentity:'https://github.com/a/b',indexedCommit:'a'.repeat(40)},question,scopeNotice:'Indexed',indexedOnly:false,answer:{mode:'facts',notice:'Facts only',answer:'Backend source evidence',citations:[]} });
  const a=create('one','s1','c1','My first question');
  const b=create('two','s1','c1','My follow-up question');
  const other=create('three','s2','c2','Other repository question');
  const html=renderMentorBody({status:'ready',message:'Ready',result:b,history:[a,other,b],canPrevious:true,canLatest:false});
  assert(html.includes('question-bubble')); assert(html.includes('answer-bubble'));
  assert(html.includes('My first question')); assert(html.includes('My follow-up question'));
  assert(!html.includes('Other repository question'));
});
