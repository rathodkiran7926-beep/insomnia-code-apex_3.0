const test = require('node:test'); const assert = require('node:assert/strict'); const { createServer } = require('node:http');
const { MentorApi } = require('../.test-output/library.cjs');
const repo = 'https://github.com/a/b', url = `${repo}/pull/7`;
const page = () => ({ repository: repo, state: 'all', page: 1, hasMore: false, pullRequests: [{ number: 7, title: 'Change app', url, state: 'open', draft: false, merged: false, head: 'feature', base: 'main', updatedAt: '2026-10-24T00:00:00Z' }] });
const comparison = () => ({ id: 'comparison', createdAt: '2026-10-24T00:00:00Z', beforeSnapshotId: 'before', afterSnapshotId: 'after', pr: { url, number: 7, title: 'Change app', state: 'open', baseRepository: repo, headRepository: repo, baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40), targetCommit: 'c'.repeat(40), baseBranch: 'main', headBranch: 'feature', changedFiles: 0, limited: false, files: [] }, components: [], edges: { added: [], removed: [] }, impact: { before: [], after: [] }, setup: { environment: [], dependencies: [], scripts: [], migrations: [], guides: { before: [], after: [] } }, warnings: ['Static source only'] });
test('PR client uses bounded validated routes, rejects invalid inputs before transport and supports cancellation', async t => {
  let mode = 'ok'; const calls = []; const job = { id: 'job', status: 'complete', progress: 100, message: 'Done', comparison_id: 'comparison', url };
  const server = createServer((req, res) => { let body = ''; req.on('data', c => body += c); req.on('end', () => { calls.push({ path: req.url, method: req.method, body }); res.setHeader('Content-Type', 'application/json');
    if (mode === 'slow') return;
    if (mode === 'large') return res.end(JSON.stringify({ text: 'x'.repeat(8400000) }));
    if (mode === 'error') { res.statusCode = 429; return res.end(JSON.stringify({ error: 'busy' })); }
    const value = req.url.startsWith('/api/pr/pulls') ? page() : req.url === '/api/pr/analyses' ? { id: 'job' } : req.url === '/api/pr/analyses/job' ? job : comparison();
    res.end(JSON.stringify(mode === 'wrong' ? { ...value, id: 'wrong', repository: 'https://github.com/other/repo' } : value));
  }); }); server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const api = new MentorApi(() => `http://127.0.0.1:${server.address().port}`, { timeoutMs: 150 }); const binding = { snapshotId: 'snap', repositoryIdentity: repo };
  assert.equal(typeof api.listPullRequests, 'function');
  assert.equal((await api.listPullRequests(binding)).pullRequests.length, 1);
  assert.equal((await api.startPrAnalysis(url, repo)).id, 'job'); assert.equal((await api.prJob('job')).status, 'complete'); assert.equal((await api.prComparison('comparison', repo, url)).id, 'comparison');
  assert.deepEqual(calls.map(c => c.path), ['/api/pr/pulls?snapshotId=snap&state=all&page=1', '/api/pr/analyses', '/api/pr/analyses/job', '/api/pr/comparisons/comparison']); assert.deepEqual(JSON.parse(calls[1].body), { url });
  const count = calls.length;
  for (const action of [() => api.listPullRequests(binding, 'bad'), () => api.listPullRequests(binding, 'all', 101), () => api.startPrAnalysis(`${repo}/pull/0`, repo), () => api.prJob('../bad'), () => api.prComparison('comparison', repo, `${repo}/pull/0`)]) await assert.rejects(action(), e => e.kind === 'configuration');
  assert.equal(calls.length, count);
  mode = 'wrong'; for (const action of [() => api.listPullRequests(binding), () => api.prJob('job'), () => api.prComparison('comparison', repo, url)]) await assert.rejects(action(), e => e.kind === 'response');
  mode = 'large'; for (const action of [() => api.listPullRequests(binding), () => api.prJob('job'), () => api.prComparison('comparison', repo, url), () => api.startPrAnalysis(url, repo)]) await assert.rejects(action(), e => e.kind === 'response');
  mode = 'error'; await assert.rejects(api.startPrAnalysis(url, repo), e => e.kind === 'http' && e.status === 429);
  mode = 'slow'; await assert.rejects(api.prJob('job'), e => e.kind === 'timeout'); const abort = new AbortController(); const pending = api.listPullRequests(binding, 'all', 1, abort.signal); abort.abort(); await assert.rejects(pending, e => e.kind === 'cancelled');
});
