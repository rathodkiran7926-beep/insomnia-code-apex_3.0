const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { MentorApi } = require('../.test-output/library.cjs');
const sha = 'a'.repeat(40);
const ref = { id: 'ref0', snapshotId: 'snap', file: 'src/a.ts', startLine: 1, endLine: 2, url: `https://github.com/a/b/blob/${sha}/src/a.ts#L1-L2` };
const rawSnapshot = { snapshotId: 'snap', repository: 'https://github.com/a/b', commit: sha, components: [{ id: 'c0', name: 'first', role: 'function', referenceId: 'ref0' }], references: [ref], relationships: [], report: { limitations: [] }, documentation: { snapshotId: 'snap' } };
test('typed Mentor requests use existing contracts and preserve HTTP, cancellation and timeout errors', async t => {
  let mode = 'facts'; let status = 200; let stall = false; let requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, method: req.method, body: body ? JSON.parse(body) : undefined });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    if (stall) { res.write('{'); return; }
    if (status !== 200) { res.end('{"error":"Busy or unavailable"}'); return; }
    let data;
    if (req.url === '/api/snapshots/snap') data = rawSnapshot;
    if (req.url === '/api/ide/resolve-selection') data = { snapshotId: 'snap', candidates: [{ componentId: 'c0', name: 'first', role: 'function', referenceId: 'ref0' }], scope: 'declaration', notice: 'Indexed component' };
    if (req.url === '/api/snapshots/snap/questions') data = { snapshotId: 'snap', componentId: 'c0', answer: 'Checks source evidence.', mode, notice: 'Review the indexed facts.', referenceIds: ['ref0'], citations: [ref] };
    if (req.url === '/api/snapshots/snap/source?referenceId=ref0') data = { snapshotId: 'snap', file: 'src/a.ts', complete: true, startLine: 1, endLine: 3, excerpt: 'first\nsecond\n', url: `https://github.com/a/b/blob/${sha}/src/a.ts#L1` };
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = () => `http://127.0.0.1:${server.address().port}`;
  const api = new MentorApi(base, { timeoutMs: 1000 });
  const evidence = await api.evidence('snap');
  await api.resolveSelection(evidence, 'src/a.ts', 1, 1);
  assert.deepEqual(requests.at(-1).body, { snapshotId: 'snap', file: 'src/a.ts', startLine: 1, endLine: 1 });
  await assert.rejects(api.resolveSelection(evidence, 'src/a.ts', 99, 99), error => error.kind === 'response');
  for (mode of ['facts', 'ai']) assert.equal((await api.question(evidence, 'c0', 'Why?')).mode, mode);
  assert.deepEqual(requests.at(-1).body, { componentId: 'c0', question: 'Why?' });
  assert.equal((await api.source(evidence, evidence.references[0])).complete, true);
  for (status of [400, 404, 429, 500]) await assert.rejects(api.question(evidence, 'c0', 'Why?'), error => error.kind === 'http' && error.status === status);
  status = 200; stall = true;
  await assert.rejects(new MentorApi(base, { timeoutMs: 40 }).question(evidence, 'c0', 'Why?'), error => error.kind === 'timeout');
  const controller = new AbortController(); const pending = api.resolveSelection(evidence, 'src/a.ts', 1, 1, controller.signal); controller.abort();
  await assert.rejects(pending, error => error.kind === 'cancelled');
});
