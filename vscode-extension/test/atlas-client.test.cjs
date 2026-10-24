const test = require('node:test'); const assert = require('node:assert/strict'); const { createServer } = require('node:http');
const { MentorApi } = require('../.test-output/library.cjs');
test('typed neighborhood transport uses safe bounded GET, validates identity and handles byte limits/status/cancellation', async t => {
  const sha = 'a'.repeat(40); let mode = 'ok'; const calls = [];
  const component = { id: 'c0', name: 'zero', role: 'function', referenceId: 'r0' };
  const body = { snapshotId: 'snap', repository: 'https://github.com/a/b', commit: sha, component, components: [component], incoming: [], outgoing: [], references: [{ id: 'r0', snapshotId: 'snap', file: 'a.ts', startLine: 1, endLine: 1, url: `https://github.com/a/b/blob/${sha}/a.ts#L1-L1` }], documentation: [], limitations: [], truncated: false, limit: 25 };
  const server = createServer((req, res) => { calls.push(req.url); res.setHeader('Content-Type', 'application/json');
    if (mode === 'large') return res.end(JSON.stringify({ text: 'x'.repeat(2000001) }));
    if (mode === 'slow') return;
    if (mode === 'error') { res.statusCode = 429; return res.end(JSON.stringify({ error: 'busy' })); }
    res.end(JSON.stringify({ ...body, ...(mode === 'wrong' ? { snapshotId: 'other' } : {}) }));
  }); server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const api = new MentorApi(() => `http://127.0.0.1:${server.address().port}`, { timeoutMs: 500 });
  assert.equal((await api.neighborhood('snap', 'c0')).component.id, 'c0'); assert.equal(calls[0], '/api/ide/snapshots/snap/components/c0/neighborhood?limit=25');
  for (const modeName of ['wrong', 'large']) { mode = modeName; await assert.rejects(api.neighborhood('snap', 'c0'), e => e.kind === 'response'); }
  mode = 'error'; await assert.rejects(api.neighborhood('snap', 'c0'), e => e.status === 429);
  const count = calls.length; await assert.rejects(api.neighborhood('snap', '../bad')); assert.equal(calls.length, count);
  mode = 'slow'; const abort = new AbortController(); const request = api.neighborhood('snap', 'c0', 25, abort.signal); abort.abort(); await assert.rejects(request, e => e.kind === 'cancelled');
});
