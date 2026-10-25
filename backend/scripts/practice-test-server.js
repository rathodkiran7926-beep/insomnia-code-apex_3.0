// Isolated browser fixture: never imported by the application server.
import assert from 'node:assert/strict';
if (process.env.PRACTICE_TEST_PROVIDER !== '1' || !process.env.DATABASE_PATH?.includes('practice-ui-'))
  throw new Error('Use only through verify-practice-ui.js');
process.env.LLM_BASE_URL = 'https://practice-model.invalid/v1';
process.env.LLM_API_KEY = 'isolated-practice-test-key';
process.env.LLM_MODEL = 'isolated-practice-model';
const { analyze } = await import('../src/analyzer.js');
const { documentGraph } = await import('../src/documentation.js');
const { db, saveSnapshot } = await import('../src/storage.js');
const files = {
  'src/users.ts': 'export function normalizeEmail(email: string) { return email.trim(); }\nexport function createUser(email: string) { return normalizeEmail(email); }',
  'src/routes.ts': "import express from 'express'; import {createUser} from './users'; const app=express(); app.post('/users', register); function register(req,res) { return res.json(createUser(req.body.email)); }",
};
const graph = analyze({ repository: 'https://github.com/test/practice-checkout', commit: 'd'.repeat(40), files });
saveSnapshot(graph, await documentGraph(graph, { generateAI: false }), '', files);
db.prepare('INSERT INTO analysis_jobs VALUES (?,?,?,?,?,?)').run('practice-ui-job', 'complete', 100, 'Ready', graph.snapshotId, new Date().toISOString());
const original = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const target = String(url);
  if (target.startsWith('https://api.github.com/repos/test/practice-checkout')) {
    if (target.includes('/commits?')) return Response.json([{sha:'d'.repeat(40),commit:{message:'Add account input validation',author:{name:'Fixture developer',date:'2026-10-25T10:00:00Z'}},author:{login:'fixture-dev'}}]);
    if (target.includes('/pulls?')) return Response.json([{number:17,title:'Validate account input',state:'closed',merged_at:'2026-10-25T10:00:00Z',updated_at:'2026-10-25T10:00:00Z',user:{login:'fixture-dev'},head:{ref:'validation'},base:{ref:'main'}}]);
    return Response.json({private:false});
  }
  if (!target.includes('/chat/completions')) return original(url, options);
  assert.equal(String(url), 'https://practice-model.invalid/v1/chat/completions');
  const body = JSON.parse(options.body);
  assert.equal(body.model, 'isolated-practice-model');
  const evidence = JSON.parse(body.messages[1].content);
  const components = evidence.components.filter((component) => component.role !== 'module').slice(0, 3);
  const tasks = components.map((component, index) => ({
    title: ['Validate account input before normalization', 'Handle empty account identifiers explicitly', 'Add source-aligned account validation tests'][index],
    objective: `Propose an explicit empty-input behavior around ${component.name}, preserving the current supported string-input behavior and documenting the changed contract.`,
    whyItMatters: 'The selected repository accepts account input, so an explicit empty-input contract makes changes easier to review.',
    acceptanceCriteria: ['Document the behavior for empty input.', 'Preserve supported nonempty string input.'],
    componentId: component.id, referenceIds: [component.referenceId],
    firstHint: 'Inspect the declared parameters and the first operation that consumes the input.',
  }));
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tasks }) } }] }), { headers: { 'Content-Type': 'application/json' } });
};
await import('../src/server.js');

db.prepare('INSERT INTO pr_comparisons VALUES (?,?,?,?)').run('progress-pr-fixture',graph.snapshotId,graph.snapshotId,JSON.stringify({id:'progress-pr-fixture',createdAt:'2026-10-25T10:00:00Z',pr:{number:17,title:'Validate account input',files:[{path:'src/users.ts'}]}}));
